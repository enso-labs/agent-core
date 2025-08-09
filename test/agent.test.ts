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
    assert(!(result instanceof ReadableStream), 'Result should not be a ReadableStream when stream=false');
    assert((result as any).content);
    assert((result as any).state);
  });

  it('should return a tool call response', async () => {
    const result = await agentLoop({
      prompt: 'What is the weather in Tokyo?',
      tools: [getWeatherTool] as unknown as Tool[],
    });
    console.log(JSON.stringify(result, null, 2));
    assert(!(result instanceof ReadableStream), 'Result should not be a ReadableStream when stream=false');
    assert((result as any).content);
    assert((result as any).state);
  });

  it('should return streaming response', async () => {
    const result = await agentLoop({
      prompt: 'What is the weather in Tokyo?',
      tools: [getWeatherTool] as unknown as Tool[],
      stream: true,
    });
    
    // Validate that we get a ReadableStream
    assert(result instanceof ReadableStream, 'Result should be a ReadableStream');
    
    const reader = result.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let hasMemory = false;
    let hasContent = false;
    let hasComplete = false;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        chunks.push(chunk);
        console.log(chunk);
        
        // Parse SSE data
        const lines = chunk.split('\n\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.substring(6));
            
            if (data.type === 'memory') {
              hasMemory = true;
              assert(data.state, 'Memory chunk should have state');
              assert(data.state.thread, 'State should have thread');
              assert(Array.isArray(data.state.thread.events), 'Thread should have events array');
            } else if (data.type === 'content') {
              hasContent = true;
              assert(typeof data.content === 'string', 'Content should be a string');
            } else if (data.type === 'complete') {
              hasComplete = true;
              assert(data.state, 'Complete chunk should have final state');
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    
    // Validate we received all expected chunk types
    assert(hasMemory, 'Stream should include memory chunk');
    assert(hasContent, 'Stream should include content chunks');
    assert(hasComplete, 'Stream should include completion chunk');
    assert(chunks.length > 0, 'Should receive at least one chunk');
  });
});