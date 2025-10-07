import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeTools } from '../src/index.js';
import type { ThreadState } from '../src/entities/state.js';
import type { ToolIntent } from '../src/entities/tool.js';
import type { Tool } from 'langchain/tools';

function createTestTool(
        name: string,
        handler: (args: any) => Promise<string> | string,
): Tool {
        return {
                name,
                description: 'test tool',
                async invoke(args: any) {
                        return handler(args);
                },
        } as unknown as Tool;
}

function createState(): ThreadState {
        return {
                thread: {
                        usage: {prompt_tokens: 0, completion_tokens: 0, total_tokens: 0},
                        events: [],
                },
        };
}

function delay(ms: number) {
        return new Promise<void>(resolve => {
                setTimeout(() => resolve(), ms);
        });
}

function createConcurrencyTracker() {
        let current = 0;
        let max = 0;
        return {
                start() {
                        current += 1;
                        if (current > max) {
                                max = current;
                        }
                },
                end() {
                        current = Math.max(0, current - 1);
                },
                get maxConcurrent() {
                        return max;
                },
        };
}

describe('executeTools parallel scheduling', () => {
        it('enforces concurrency limits and preserves event ordering', async () => {
                const tracker = createConcurrencyTracker();
                const slowTool = createTestTool('math_calculator', async ({expression}: {expression: string}) => {
                        const payload = JSON.parse(expression) as {value: string; delay: number};
                        tracker.start();
                        await delay(payload.delay);
                        tracker.end();
                        return payload.value;
                });

                const intents: ToolIntent[] = [
                        {intent: 'math_calculator', args: {expression: JSON.stringify({value: 'A', delay: 60})}, runMode: 'parallel'},
                        {intent: 'math_calculator', args: {expression: JSON.stringify({value: 'B', delay: 20})}, runMode: 'parallel'},
                        {intent: 'math_calculator', args: {expression: JSON.stringify({value: 'C', delay: 40})}, runMode: 'parallel'},
                ];

                const {state, summary} = await executeTools(intents, createState(), [slowTool], {
                        concurrency: 2,
                });

                assert.equal(summary.total, 3);
                assert.equal(summary.successCount, 3);
                assert.equal(summary.failureCount, 0);
                assert.ok(tracker.maxConcurrent <= 2);

                const contents = state.thread.events.map(event => event.content);
                assert.deepEqual(contents, ['A', 'B', 'C']);
        });

        it('records failures without disrupting other results', async () => {
                const tool = createTestTool('math_calculator', async ({expression}: {expression: string}) => {
                        if (expression === 'boom') {
                                throw new Error('boom');
                        }
                        return expression;
                });

                const intents: ToolIntent[] = [
                        {intent: 'math_calculator', args: {expression: 'ok'}, runMode: 'parallel'},
                        {intent: 'math_calculator', args: {expression: 'boom'}, runMode: 'parallel'},
                ];

                const {state, summary} = await executeTools(intents, createState(), [tool], {
                        concurrency: 2,
                });

                assert.equal(summary.total, 2);
                assert.equal(summary.successCount, 1);
                assert.equal(summary.failureCount, 1);
                assert.equal(summary.failures.length, 1);

                const failureEvent = state.thread.events.find(event => event.content.includes('Tool execution failed'));
                assert.ok(failureEvent, 'expected failure event');
                assert.equal(failureEvent?.metadata.status, 'error');
        });

        it('falls back to sequential execution when concurrency is disabled', async () => {
                const tool = createTestTool('math_calculator', async ({expression}: {expression: string}) => expression);

                const intents: ToolIntent[] = [
                        {intent: 'math_calculator', args: {expression: 'first'}, runMode: 'parallel'},
                        {intent: 'math_calculator', args: {expression: 'second'}, runMode: 'parallel'},
                ];

                const {state, summary} = await executeTools(intents, createState(), [tool], {
                        concurrency: 1,
                });

                assert.equal(summary.successCount, 2);
                assert.equal(summary.failureCount, 0);

                const contents = state.thread.events.map(event => event.content);
                assert.deepEqual(contents.slice(0, 2), ['first', 'second']);
                const warning = state.thread.events.at(-1);
                assert.equal(warning?.intent, 'parallel_execution_warning');
        });

        it('emits onResult callbacks in settlement order while preserving state order', async () => {
                const tracker = createConcurrencyTracker();
                const tool = createTestTool('math_calculator', async ({expression}: {expression: string}) => {
                        const payload = JSON.parse(expression) as {value: string; delay: number};
                        tracker.start();
                        await delay(payload.delay);
                        tracker.end();
                        return payload.value;
                });

                const intents: ToolIntent[] = [
                        {intent: 'math_calculator', args: {expression: JSON.stringify({value: 'slow', delay: 60})}, runMode: 'parallel'},
                        {intent: 'math_calculator', args: {expression: JSON.stringify({value: 'fast', delay: 10})}, runMode: 'parallel'},
                        {intent: 'math_calculator', args: {expression: JSON.stringify({value: 'medium', delay: 30})}, runMode: 'parallel'},
                ];

                const completionOrder: number[] = [];

                const {state, summary} = await executeTools(intents, createState(), [tool], {
                        concurrency: 3,
                        onResult: result => {
                                completionOrder.push(result.index);
                        },
                });

                assert.equal(summary.total, 3);
                assert.equal(summary.successCount, 3);
                assert.deepEqual(completionOrder, [1, 2, 0]);

                const contents = state.thread.events.map(event => event.content);
                assert.deepEqual(contents, ['slow', 'fast', 'medium']);
        });
});
