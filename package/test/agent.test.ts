import { test } from 'node:test';
import assert from 'node:assert';
import { agentLoop } from '../src/index.js';
import { Tool, tool } from '@langchain/core/tools';
import { z } from 'zod';

function getWeather(location: string) {
  return `The weather in ${location} is sunny and 70 degrees`;
}
const getWeatherTool = tool(getWeather, {
	name: 'get_weather',
	description: 'Get the weather in a location',
	schema: z.object({
		location: z.string().describe('The location to get the weather for'),
	}),
});

test('agentLoop returns response', async () => {
  const state = {
    thread: {
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      events: []
    }
  };
  
  const result = await agentLoop('Weather in Tokyo?', state, "openai:gpt-4o-mini", [getWeatherTool] as unknown as Tool[]);
  
  assert(result.content);
  assert(result.state);
});