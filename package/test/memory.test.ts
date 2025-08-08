


import {describe, it} from 'node:test';
import assert from 'node:assert';
import { agentMemory } from '../src/index.js';

const state = {
	thread: {
		usage: {
			prompt_tokens: 0,
			completion_tokens: 0,
			total_tokens: 0,
		},
		events: [],
	},
};


describe('Testing Memory', () => {
  it('adds user_input event to state', async () => {
		const result = await agentMemory('user_input', 'Test message', state, { test: 'metadata' });
		assert.strictEqual(result.thread.events.length, 1);
		assert.deepStrictEqual(result.thread.events[0], {
			intent: 'user_input',
			content: 'Test message',
			metadata: { test: 'metadata' },
		});
  });
});