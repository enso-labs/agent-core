// Define tool intent interfaces
interface WeatherIntent {
	intent: 'get_weather';
	args: {location: string};
}

interface StockIntent {
	intent: 'get_stock_info';
	args: {ticker: string};
}

interface WebSearchIntent {
	intent: 'web_search';
	args: {query: string};
}

interface MathIntent {
	intent: 'math_calculator';
	args: {expression: string};
}

interface FileSearchIntent {
	intent: 'file_search';
	args: {pattern: string; directory?: string};
}

interface ReadFileIntent {
	intent: 'read_file';
	args: {filepath: string};
}

interface CreateFileIntent {
	intent: 'create_file';
	args: {filepath: string; content: string};
}

interface GitStatusIntent {
	intent: 'git_status';
	args: Record<string, never>;
}

interface PwdIntent {
	intent: 'pwd';
	args: Record<string, never>;
}

interface TerminalCommandIntent {
	intent: 'terminal_command';
	args: {command: string; timeout?: number};
}

interface NpmInfoIntent {
	intent: 'npm_info';
	args: {package: string};
}

interface NoIntent {
	intent: 'none';
	args: Record<string, never>;
}

type ToolIntent =
	| WeatherIntent
	| StockIntent
	| WebSearchIntent
	| MathIntent
	| FileSearchIntent
	| ReadFileIntent
	| CreateFileIntent
	| GitStatusIntent
	| PwdIntent
	| TerminalCommandIntent
	| NpmInfoIntent
	| NoIntent;

export type {ToolIntent};
