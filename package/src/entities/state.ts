
export type ThreadState = {
	thread: {
		usage: {
			prompt_tokens: number;
			completion_tokens: number;
			total_tokens: number;
		};
		systemMessage?: string;
		events: {
			intent: string;
			content: string;
			args?: any;
			metadata: any;
		}[];
	};
};

export interface AgentResponse {
	content: string;
	state: ThreadState;
	tokens?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}