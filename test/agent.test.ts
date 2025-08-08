import { test, it, describe } from 'node:test';
import assert from 'node:assert';
import { agentLoop } from '../src/index.js';
import { Tool, tool } from '@langchain/core/tools';
import { z } from 'zod';

function getWeather({location}: {location: string}): string {
  return `The weather in ${location} is sunny and 70 degrees`;
}
const getWeatherTool = tool(getWeather, {
	name: 'get_weather',
	description: 'Get the weather in a location',
	schema: z.object({
		location: z.string().describe('The location to get the weather for'),
	}),
});

describe('agentLoop', () => {

  it('should return a response', async () => {
    const result = await agentLoop({
      prompt: 'Who won the 2001 world series?',
    });
    console.log(JSON.stringify(result, null, 2));
    assert(result.content);
    assert(result.state);
  });

  it('should return a tool call response', async () => {
    const result = await agentLoop({
      prompt: 'What is the weather in Tokyo?',
      tools: [getWeatherTool] as unknown as Tool[],
    });
    console.log(JSON.stringify(result, null, 2));
    assert(result.content);
    assert(result.state);
  });
});