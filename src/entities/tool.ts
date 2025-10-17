// Define tool intent interfaces
export type ToolRunMode = 'parallel' | 'sequential';

interface ParallelExecutionMetadata {
        runMode?: ToolRunMode;
        priority?: number;
        groupId?: string;
}

interface WeatherIntent extends ParallelExecutionMetadata {
        intent: 'get_weather';
        args: {location: string};
}

interface StockIntent extends ParallelExecutionMetadata {
        intent: 'get_stock_info';
        args: {ticker: string};
}

interface WebSearchIntent extends ParallelExecutionMetadata {
        intent: 'web_search';
        args: {query: string};
}

interface MathIntent extends ParallelExecutionMetadata {
        intent: 'math_calculator';
        args: {expression: string};
}

interface FileSearchIntent extends ParallelExecutionMetadata {
        intent: 'file_search';
        args: {pattern: string; directory?: string};
}

interface ReadFileIntent extends ParallelExecutionMetadata {
        intent: 'read_file';
        args: {filepath: string};
}

interface CreateFileIntent extends ParallelExecutionMetadata {
        intent: 'create_file';
        args: {filepath: string; content: string};
}

interface GitStatusIntent extends ParallelExecutionMetadata {
        intent: 'git_status';
        args: Record<string, never>;
}

interface PwdIntent extends ParallelExecutionMetadata {
        intent: 'pwd';
        args: Record<string, never>;
}

interface TerminalCommandIntent extends ParallelExecutionMetadata {
        intent: 'terminal_command';
        args: {command: string; timeout?: number};
}

interface NpmInfoIntent extends ParallelExecutionMetadata {
        intent: 'npm_info';
        args: {package: string};
}

interface NoIntent extends ParallelExecutionMetadata {
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

export type {ToolIntent, ParallelExecutionMetadata};
