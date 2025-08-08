import 'dotenv/config'
import {z} from 'zod';
import {tool} from '@langchain/core/tools';
import { Tool } from 'langchain/tools';
import { agentLoop } from '@enso-labs/agent-core';

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

async function main() {
	const response = await agentLoop({
		prompt: "What is the weather in San Francisco?",
		tools: [getWeatherTool as unknown as Tool],
	});
	console.log(response);
}

main();