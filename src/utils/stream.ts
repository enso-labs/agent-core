import { agentMemory } from '../index.js';
import type { ThreadState } from '../entities/state.js';

export function streamHandler(llmStream: any, state: ThreadState) {
	let fullResponse = '';
      
	const encoder = new TextEncoder();
	const readable = new ReadableStream({
		async start(controller) {
			try {
				// Send initial data with memory (convert to XML for compatibility)
				controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
					type: 'memory', 
					state 
				})}\n\n`));
				
				// Process streaming response
				for await (const chunk of llmStream) {
					const content = chunk.content || '';
					state.thread.usage = chunk.response_metadata?.usage;
					if (content) {
						fullResponse += content;
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
							type: 'content', 
							content: content 
						})}\n\n`));
					}
				}
				
				// Add final response to memory
				state = await agentMemory('llm_response', fullResponse, state);
				
				// Send completion message (convert to XML for compatibility)
				controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
					type: 'complete', 
					state
				})}\n\n`));
				
				controller.close();
			} catch (error) {
				console.error('Streaming error:', error);
				controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
					type: 'error', 
					error: 'Streaming failed' 
				})}\n\n`));
				controller.close();
			}
		},
	});
	return readable;
}

export async function jsonHandler(
	llmResponse: any,
	state: ThreadState,
	model?: string,
	usage_metadata?: any,
): Promise<{content: string, state: ThreadState, tokens: any}> {
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
}