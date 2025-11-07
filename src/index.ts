import type { ThreadState, AgentResponse } from "./entities/state.js";
import { classifyIntent } from "./utils/classify.js";
import { callModel } from "./utils/llm.js";
import type { ToolIntent, ToolRunMode } from "./entities/tool.js";
import { Tool } from "langchain/tools";
import { jsonHandler, streamHandler } from "./utils/stream.js";

export const DEFAULT_MODEL = "openai:gpt-4.1-nano";

export async function agentMemory(
	toolIntent: {intent: string; args: any} | string,
	content: string,
	state: ThreadState,
	metadata: any = {},
): Promise<ThreadState> {
	const intent =
		typeof toolIntent === 'string' ? toolIntent : toolIntent.intent;
	// Create event object
	const event: ThreadState['thread']['events'][0] = {
		intent,
		content,
		metadata,
	};

	// Add additional attributes for tool events
	if (
		intent !== 'user_input' &&
		intent !== 'lm_response' &&
		typeof toolIntent !== 'string' &&
		'args' in toolIntent
	) {
		event.args = toolIntent.args;
	}

	// Add the new event to the state
	const newState: ThreadState = {
		thread: {
			usage: state.thread.usage,
			...(state.thread.systemMessage !== undefined && { systemMessage: state.thread.systemMessage }),
			events: [...state.thread.events, event],
		},
	};

	return newState;
}

type EventStatusOptions = {
	status?: string;
	message?: string;
};

function eventStatus({status}: EventStatusOptions = {}) {
        const map: Record<string, {icon: string; label: string}> = {
                error: {icon: '❌', label: 'error'},
                success: {icon: '✅', label: 'success'},
                pending: {icon: '⏳', label: 'pending'},
                waiting_for_feedback: {icon: '🕒', label: 'waiting_for_feedback'},
        };
        const statusKey = status ?? '';
        const {icon, label} = map[statusKey] || {icon: '❓', label: 'unknown'};
        return {
                icon,
                status: label,
        };
}

type IndexedToolIntent = ToolIntent & { __index: number };

export interface ToolExecutionFailure {
        index: number;
        intent: ToolIntent;
        error: string;
}

export interface ToolExecutionResult {
        index: number;
        intent: ToolIntent;
        status: 'success' | 'error';
        content: string;
        metadata: Record<string, any>;
        error?: Error;
        startedAt: number;
        endedAt: number;
}

export interface ToolExecutionSummary {
        total: number;
        completed: number;
        successCount: number;
        failureCount: number;
        failures: ToolExecutionFailure[];
}

export interface ToolExecutionProgress extends ToolExecutionSummary {}

export interface SchedulerBatchContext {
        batchId: string;
        size: number;
        mode: ToolRunMode;
        groupId: string | null;
}

export interface SchedulerBatchResult extends SchedulerBatchContext {
        durationMs: number;
        results: ToolExecutionResult[];
        summary: ToolExecutionSummary;
}

export interface SchedulerHooks {
        onBatchStart?(context: SchedulerBatchContext): void | Promise<void>;
        onBatchComplete?(result: SchedulerBatchResult): void | Promise<void>;
        onFailure?(result: ToolExecutionResult): void | Promise<void>;
        onProgress?(progress: ToolExecutionProgress): void | Promise<void>;
}

export interface ParallelExecutionOptions {
        concurrency?: number;
        onResult?(result: ToolExecutionResult): void | Promise<void>;
        scheduler?: SchedulerHooks;
}

type ScheduledBatch = {
        id: string;
        mode: ToolRunMode;
        groupId: string | null;
        intents: IndexedToolIntent[];
};

const DEFAULT_CONCURRENCY = 1;

async function safeInvoke<Args extends any[]>(
        callback: ((...args: Args) => any) | undefined,
        ...args: Args
) {
        if (!callback) {
                return;
        }

        try {
                await callback(...args);
        } catch (error) {
                console.warn('Parallel tool callback threw', error);
        }
}

function resolveTool(toolIntent: ToolIntent, tools: Tool[]) {
        const tool = tools.find(t => t.name === toolIntent.intent);
        if (!tool) {
                throw new Error(`Tool ${toolIntent.intent} not found`);
        }
        return tool;
}

async function invokeTool(tool: Tool, args: any) {
        return tool.invoke(args);
}

async function executeToolIntent(
        indexedIntent: IndexedToolIntent,
        tools: Tool[],
): Promise<ToolExecutionResult> {
        const {__index, ...rest} = indexedIntent;
        const baseIntent = rest as ToolIntent;

        if (baseIntent.intent === 'none') {
                return {
                        index: __index,
                        intent: baseIntent,
                        status: 'success',
                        content: '',
                        metadata: eventStatus({status: 'success'}),
                        startedAt: Date.now(),
                        endedAt: Date.now(),
                };
        }

        const startedAt = Date.now();
        try {
                const tool = resolveTool(baseIntent, tools);
                const toolOutput = await invokeTool(tool, baseIntent.args);
                const endedAt = Date.now();
                return {
                        index: __index,
                        intent: baseIntent,
                        status: 'success',
                        content: toolOutput,
                        metadata: {
                                ...eventStatus({status: 'success'}),
                                toolName: baseIntent.intent,
                                durationMs: endedAt - startedAt,
                        },
                        startedAt,
                        endedAt,
                };
        } catch (error) {
                const endedAt = Date.now();
                const err = error instanceof Error ? error : new Error('Unknown error');
                const errorMessage = `Tool execution failed: ${err.message}`;
                return {
                        index: __index,
                        intent: baseIntent,
                        status: 'error',
                        content: errorMessage,
                        metadata: {
                                ...eventStatus({status: 'error'}),
                                toolName: baseIntent.intent,
                                durationMs: endedAt - startedAt,
                                errorName: err.name,
                        },
                        error: err,
                        startedAt,
                        endedAt,
                };
        }
}

function scheduleIntents(intents: IndexedToolIntent[]): ScheduledBatch[] {
        const batches: ScheduledBatch[] = [];
        let parallelBatch: ScheduledBatch | null = null;

        intents.forEach((intent, idx) => {
                const runMode: ToolRunMode = intent.runMode ?? 'sequential';
                const groupId = intent.groupId ?? null;

                if (runMode === 'parallel') {
                        if (
                                parallelBatch &&
                                parallelBatch.mode === 'parallel' &&
                                parallelBatch.groupId === groupId
                        ) {
                                parallelBatch.intents.push(intent);
                        } else {
                                if (parallelBatch) {
                                        batches.push(parallelBatch);
                                }
                                parallelBatch = {
                                        id: groupId ?? `parallel-${idx}`,
                                        mode: 'parallel',
                                        groupId,
                                        intents: [intent],
                                };
                        }
                } else {
                        if (parallelBatch) {
                                batches.push(parallelBatch);
                                parallelBatch = null;
                        }
                        batches.push({
                                id: `sequential-${idx}`,
                                mode: 'sequential',
                                groupId,
                                intents: [intent],
                        });
                }
        });

        if (parallelBatch) {
                batches.push(parallelBatch);
        }

        return batches;
}

function snapshotSummary(summary: ToolExecutionSummary): ToolExecutionSummary {
        return {
                total: summary.total,
                completed: summary.completed,
                successCount: summary.successCount,
                failureCount: summary.failureCount,
                failures: [...summary.failures],
        };
}

async function settleIntent(
        intent: IndexedToolIntent,
        tools: Tool[],
        summary: ToolExecutionSummary,
        options: ParallelExecutionOptions,
): Promise<ToolExecutionResult> {
        const result = await executeToolIntent(intent, tools);

        if (result.status === 'success') {
                summary.successCount += 1;
        } else {
                summary.failureCount += 1;
                summary.failures.push({
                        index: result.index,
                        intent: result.intent,
                        error: result.error?.message ?? 'Unknown error',
                });
                await safeInvoke(options.scheduler?.onFailure, result);
        }

        summary.completed = summary.successCount + summary.failureCount;

        await safeInvoke(options.onResult, result);
        await safeInvoke(options.scheduler?.onProgress, snapshotSummary(summary));

        return result;
}

async function runSequentialBatch(
        batch: ScheduledBatch,
        tools: Tool[],
        summary: ToolExecutionSummary,
        options: ParallelExecutionOptions,
): Promise<ToolExecutionResult[]> {
        const results: ToolExecutionResult[] = [];
        for (const intent of batch.intents) {
                const result = await settleIntent(intent, tools, summary, options);
                if (result.intent.intent !== 'none') {
                        results.push(result);
                }
        }
        return results;
}

async function runParallelBatch(
        batch: ScheduledBatch,
        tools: Tool[],
        summary: ToolExecutionSummary,
        options: ParallelExecutionOptions,
        concurrency: number,
): Promise<ToolExecutionResult[]> {
        const queue = [...batch.intents].sort((a, b) => {
                const priorityA = a.priority ?? Number.POSITIVE_INFINITY;
                const priorityB = b.priority ?? Number.POSITIVE_INFINITY;
                if (priorityA !== priorityB) {
                        return priorityA - priorityB;
                }
                return a.__index - b.__index;
        });

        const results: ToolExecutionResult[] = [];
        const workers: Promise<void>[] = [];

        const worker = async () => {
                while (queue.length > 0) {
                        const intent = queue.shift();
                        if (!intent) {
                                return;
                        }
                        const result = await settleIntent(intent, tools, summary, options);
                        if (result.intent.intent !== 'none') {
                                results.push(result);
                        }
                }
        };

        const workerCount = Math.max(1, Math.min(concurrency, queue.length));
        for (let i = 0; i < workerCount; i += 1) {
                workers.push(worker());
        }

        await Promise.all(workers);
        return results;
}

export async function executeTools(
        toolIntents: ToolIntent[],
        state: ThreadState,
        tools: Tool[],
        options: ParallelExecutionOptions = {},
): Promise<{ state: ThreadState; summary: ToolExecutionSummary }>
{
        const scheduler = options.scheduler;
        const configuredConcurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
        const normalizedConcurrency = Number.isFinite(configuredConcurrency)
                ? Math.max(1, Math.floor(configuredConcurrency))
                : DEFAULT_CONCURRENCY;

        const actionableIntents = toolIntents
                .map((intent, index) => ({...intent, __index: index}))
                .filter(intent => intent.intent !== 'none');

        const summary: ToolExecutionSummary = {
                total: actionableIntents.length,
                completed: 0,
                successCount: 0,
                failureCount: 0,
                failures: [],
        };

        if (actionableIntents.length === 0) {
                return {state, summary};
        }

        const batches = scheduleIntents(actionableIntents);
        const containsParallel = actionableIntents.some(
                intent => (intent.runMode ?? 'sequential') === 'parallel',
        );
        const parallelEnabled = normalizedConcurrency > 1;
        const shouldWarnParallelDisabled = containsParallel && !parallelEnabled;

        const allResults: ToolExecutionResult[] = [];

        for (const batch of batches) {
                const batchStart = Date.now();
                await safeInvoke(scheduler?.onBatchStart, {
                        batchId: batch.id,
                        size: batch.intents.length,
                        mode: batch.mode,
                        groupId: batch.groupId,
                });

                let batchResults: ToolExecutionResult[] = [];

                if (batch.mode === 'parallel' && parallelEnabled) {
                        batchResults = await runParallelBatch(
                                batch,
                                tools,
                                summary,
                                options,
                                normalizedConcurrency,
                        );
                } else {
                        batchResults = await runSequentialBatch(batch, tools, summary, options);
                }

                allResults.push(...batchResults);

                await safeInvoke(scheduler?.onBatchComplete, {
                        batchId: batch.id,
                        size: batch.intents.length,
                        mode: batch.mode,
                        groupId: batch.groupId,
                        durationMs: Date.now() - batchStart,
                        results: [...batchResults],
                        summary: snapshotSummary(summary),
                });
        }

        const orderedResults = allResults.sort((a, b) => a.index - b.index);

        for (const result of orderedResults) {
                state = await agentMemory(result.intent, result.content, state, result.metadata);
        }

        if (shouldWarnParallelDisabled) {
                state = await agentMemory(
                        'parallel_execution_warning',
                        'Parallel tool intents requested but concurrency is disabled. Falling back to sequential execution.',
                        state,
                        eventStatus({status: 'waiting_for_feedback'}),
                );
        }

        return {state, summary: snapshotSummary(summary)};
}

export function convertStateToXML(state: ThreadState): string {
	// Convert to XML format for components that still expect it
	const events = state.thread.events
		.map((event: ThreadState['thread']['events'][0]) => {
			const attrs = [`intent="${event.intent}"`];

			// Add all metadata properties as attributes
			if (event.metadata) {
				Object.entries(event.metadata).forEach(([key, value]) => {
					if (value !== undefined && value !== null) {
						attrs.push(`${key}="${value}"`);
					}
				});
			}

			return `<event ${attrs.join(' ')}>${event.content}</event>`;
		})
		.join('\n  ');

	return `<thread>\n${events}\n</thread>`;
}

export async function agentLoop({
    prompt,
    model = DEFAULT_MODEL,
    tools = [],
		state = {
        thread: {
            events: [],
						usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        },
    },
		stream = false,
}: {
    prompt: string;
    model?: string;
		tools?: Tool[];
		systemMessage?: string;
    state?: ThreadState;
		stream?: boolean;
}): Promise<AgentResponse | ReadableStream> {
	// Add user input to memory
	state = await agentMemory('user_input', prompt, state);

	// Tool execution - classify all tools from the input at once
	const [toolIntents, usage_metadata] = await classifyIntent(
		prompt,
		model.toString(),
		tools,
	);

        // Execute all identified tools
        const execution = await executeTools(toolIntents, state, tools);
        state = execution.state;
        if (execution.summary.failureCount > 0) {
                console.warn('Tool execution failures detected', execution.summary.failures);
        }

	// Generate LLM response
	const systemMessage = state.thread.systemMessage || 'You are a helpful AI assistant.';
	const conversationHistory = convertStateToXML(state);

	try {
		const llmResponse = await callModel(
			conversationHistory,
			systemMessage,
			model,
			stream,
		);
		if (stream) {
			return streamHandler(llmResponse, state);
		}
		return await jsonHandler(llmResponse, state, model, usage_metadata);
	} catch (error) {
		const errorMessage = `LLM call failed: ${
			error instanceof Error ? error.message : 'Unknown error'
		}`;
		state = await agentMemory('llm_error', errorMessage, state);

		return {
			content: errorMessage,
			state,
		};
	}
}
