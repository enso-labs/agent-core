import type { ThreadState, AgentResponse } from "./entities/state.js";
import { classifyIntent } from "./utils/classify.js";
import { callModel } from "./utils/llm.js";
import type { ToolIntent } from "./entities/tool.js";
import { Tool } from "langchain/tools";


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

export async function executeTools(
	toolIntents: ToolIntent[],
	state: ThreadState,
	tools: Tool[],
) {
	// Execute all identified tools
	for (const toolIntent of toolIntents) {
		const {intent, args} = toolIntent;

		if (intent === 'none') {
			continue;
		}

		// Check if tool exists in the tools object or handle special cases
		let toolOutput: string;
		let metadata: any = eventStatus({status: 'success'});
		try {
			const tool = tools.find(t => t.name === intent);
			if (!tool) {
				throw new Error(`Tool ${intent} not found`);
			}
			toolOutput = await tool.invoke(args);

			// Add tool execution as an event
			state = await agentMemory(toolIntent, toolOutput, state, metadata);
		} catch (error) {
			const errorMessage = `Tool execution failed: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`;
			state = await agentMemory(toolIntent, errorMessage, state);
		}
	}
	return state;
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
}: {
    prompt: string;
    model?: string;
		tools?: Tool[];
		systemMessage?: string;
    state?: ThreadState;
}): Promise<AgentResponse> {
	// Add user input to memory
	state = await agentMemory('user_input', prompt, state);

	// Tool execution - classify all tools from the input at once
	const [toolIntents, usage_metadata] = await classifyIntent(
		prompt,
		model.toString(),
		tools,
	);

	// Execute all identified tools
	state = await executeTools(toolIntents, state, tools);

	// Generate LLM response
	const systemMessage = state.thread.systemMessage || 'You are a helpful AI assistant.';
	const conversationHistory = convertStateToXML(state);

	try {
		const llmResponse = await callModel(
			conversationHistory,
			systemMessage,
			model,
		);
		const responseContent =
			typeof llmResponse.content === 'string'
				? llmResponse.content
				: JSON.stringify(llmResponse.content);

		// Add LLM response to memory
		state = await agentMemory('llm_response', responseContent, state, {
			model: model,
		});

		state.thread.usage = (() => {
			const u1 = llmResponse.usage || {};
			const u2 = usage_metadata || {};
			return {
				prompt_tokens:
					(u1.prompt_tokens || u1.input_tokens || 0) +
					(u2.input_tokens || u2.prompt_tokens || 0),
				completion_tokens:
					(u1.completion_tokens || u1.output_tokens || 0) +
					(u2.output_tokens || u2.completion_tokens || 0),
				total_tokens:
					(u1.total_tokens || u1.input_tokens + u1.output_tokens || 0) +
					(u2.total_tokens || u2.input_tokens + u2.output_tokens || 0),
			};
		})();

		return {
			content: responseContent,
			state,
			tokens: llmResponse.usage,
		};
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