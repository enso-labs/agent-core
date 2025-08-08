import 'dotenv/config'
import {z} from 'zod';
import {tool} from '@langchain/core/tools';
import { Tool } from 'langchain/tools';
import { agentLoop } from '@enso-labs/agent-core';
import { ThreadState } from '@enso-labs/agent-core/dist/entities/state';

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

const state: ThreadState = {
	thread: {
		usage: {
			prompt_tokens: 0,
			completion_tokens: 0,
			total_tokens: 0,
		},
		events: [],
	},
};

async function main() {
	const response = await agentLoop(
		"What is the weather in San Francisco?",
		state,
		"openai:gpt-4o-mini",
		[getWeatherTool] as unknown as Tool[]
	);
	console.log(response);
}

main();