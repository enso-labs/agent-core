# Enso Labs - Agent Core

A TypeScript package for managing AI agent workflows with memory, tool execution, and conversation state management.

## Installation

```bash
npm install @enso-labs/agent-core
```

## Usage

### Core Functions

#### `agentMemory(toolIntent, content, state, metadata?)`

Adds events to the thread state memory system.

**Parameters:**
- `toolIntent`: `{intent: string; args: any} | string` - The tool intent or string identifier
- `content`: `string` - The content/message to store
- `state`: `ThreadState` - Current thread state
- `metadata?`: `any` - Optional metadata object

**Returns:** `Promise<ThreadState>` - Updated state with new event

**Example:**
```typescript
import { agentMemory } from '@enso-labs/agent-core';

const newState = await agentMemory(
  'user_input',
  'Hello, how are you?',
  currentState,
  { timestamp: new Date().toISOString() }
);
```

#### `executeTools(toolIntents, state, tools, options?)`

Executes multiple tool intents (optionally in parallel) and returns the updated state alongside execution telemetry.

**Parameters:**
- `toolIntents`: `ToolIntent[]` - Array of tool intents to execute
- `state`: `ThreadState` - Current thread state
- `tools`: `Tool[]` - Array of available LangChain tools
- `options?`: `ParallelExecutionOptions` - Optional configuration including `concurrency`, `onResult` callback, and `scheduler` hooks

**Returns:** `Promise<{ state: ThreadState; summary: ToolExecutionSummary }>` - Result containing the updated state plus execution summary metadata

**Example:**
```typescript
import { executeTools } from '@enso-labs/agent-core';
import type { ParallelExecutionOptions } from '@enso-labs/agent-core';

const toolIntents = [
  { intent: 'web_search', args: { query: 'weather today' }, runMode: 'parallel' },
  { intent: 'web_search', args: { query: 'sunset time' }, runMode: 'parallel' }
];

const options: ParallelExecutionOptions = {
  concurrency: 2,
  onResult: (result) => console.log('tool finished', result.intent.intent, result.status)
};

const { state: updatedState, summary } = await executeTools(toolIntents, currentState, availableTools, options);
console.log(summary.successCount, summary.failureCount);
```

#### `convertStateToXML(state)`

Converts thread state to XML format for compatibility with systems expecting XML.

**Parameters:**
- `state`: `ThreadState` - The thread state to convert

**Returns:** `string` - XML representation of the thread state

**Example:**
```typescript
import { convertStateToXML } from '@enso-labs/agent-core';

const xmlString = convertStateToXML(currentState);
console.log(xmlString);
// Output: <thread>\n<event intent="user_input">Hello</event>\n</thread>
```

#### `agentLoop({ prompt, model?, tools?, state? })`

Main orchestration function that processes user queries through the complete agent workflow.

**Parameters (Object):**
- `prompt`: `string` - User input query
- `model?`: `string` - Model identifier (default: 'openai:gpt-4.1-nano')
- `tools?`: `Tool[]` - Array of available tools (default: [])
- `state?`: `ThreadState` - Current thread state (default: empty state with usage tracking)

**Returns:** `Promise<AgentResponse>` - Response containing content, updated state, and token usage

**Example:**
```typescript
import { agentLoop } from '@enso-labs/agent-core';
import type { ThreadState } from '@enso-labs/agent-core';

// Simple usage with just a prompt
const response = await agentLoop({
  prompt: "What is the weather like today?",
  tools: weatherTools
});

// Advanced usage with custom state
const initialState: ThreadState = {
  thread: {
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    events: []
  }
};

const response = await agentLoop({
  prompt: 'What is the weather like today?',
  state: initialState,
  model: 'openai:gpt-4o-mini',
  tools: weatherTools
});

console.log(response.content); // AI response
console.log(response.tokens);  // Token usage stats
```

## Types

### ThreadState
Main state management structure for conversation threads.

### AgentResponse
Response structure returned by `agentLoop()` containing:
- `content`: string - The AI response content
- `state`: ThreadState - Updated thread state
- `tokens?`: object - Token usage information

### ToolIntent
Structure for tool execution requests:
- `intent`: string - Tool name/identifier
- `args`: any - Tool arguments
- `runMode?`: `'parallel' | 'sequential'` - Execution preference (defaults to sequential)
- `priority?`: `number` - Optional scheduling priority (lower numbers execute sooner within a parallel batch)
- `groupId?`: `string` - Identifier to batch related intents in the same parallel group

## Error Handling

All functions include comprehensive error handling:
- Tool execution failures are captured and added to state
- LLM call failures return error messages in the response
- Invalid tool references are handled gracefully

## Dependencies

- LangChain Tools for tool execution
- Internal utilities for intent classification and LLM calls

### Source

https://medium.com/@the_nick_morgan/creating-an-npm-package-with-typescript-c38b97a793cf