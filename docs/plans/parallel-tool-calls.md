# Parallel Tool Call Support Plan

## Goals
- Allow `executeTools` to execute multiple tool invocations concurrently when it is safe to do so.
- Preserve deterministic state updates and backwards compatibility with existing sequential behaviour.
- Provide hooks for future streaming/observability of parallel executions and partial failures.

## Current State
- `executeTools` in `src/index.ts` iterates sequentially over `toolIntents`, invoking each tool with `await` and mutating `state` after every call.
- Tool failures are caught per-invocation and appended to the state as error events, but there is no differentiation between transient errors and missing tools.
- Memory updates rely on `agentMemory`, which appends events to `state.thread.events` while carrying forward usage metadata.
- Streaming mode relies on serial writes to the event stream; there is currently no facility to surface in-flight tool runs.

## Key Challenges
1. **State Mutation Ordering** – Running tools in parallel means we cannot rely on sequential `state = await agentMemory(...)` updates; we need a way to accumulate results and merge them afterwards.
2. **Tool Dependency Handling** – Some tools may depend on the output of others. We need an API to mark intents that must remain sequential.
3. **Error Aggregation** – We must surface which tool(s) failed without losing the ability to capture partial successes.
4. **Resource Limits** – Allowing unbounded parallelism could overwhelm the host. We should support a configurable concurrency limit.

## Proposed Design
The design revolves around isolating side effects while a batch of tools runs, then replaying the successful results back through existing state-mutating utilities.

1. **Execution Planner**
   - Extend `ToolIntent` to accept optional metadata, e.g. `{ intent, args, runMode?: 'parallel' | 'sequential', priority?: number, groupId?: string }`.
   - Default `runMode` to `sequential` for backwards compatibility; classifier can opt in to parallel for independent intents.
   - `groupId` allows explicit grouping of intents that must run together (e.g., map-reduce patterns) while preserving the ability to batch unrelated calls.

2. **Concurrency Controller**
   - Implement `executeToolIntent(toolIntent, stateSnapshot, tools)` that returns `{ event, metadata, error }` without mutating shared state.
   - Introduce a `runInBatches(intents, concurrency)` helper to process intents with `Promise.allSettled`, respecting `runMode`, `priority`, and `groupId`.
   - Allow a new optional argument to `executeTools`: `{ concurrency?: number, scheduler?: SchedulerHooks }`, defaulting to `1` (sequential) until callers opt in.
   - Use a `p-limit` style helper to bound in-flight executions; when concurrency is `1` the helper degenerates to the existing sequential path.

3. **State Merge Strategy**
   - After each batch, sort completed events by their original index (or explicit priority) to maintain deterministic ordering in `state.thread.events`.
   - Apply `agentMemory` once per result using the new ordered list so that `usage` bookkeeping remains centralized.
   - Ensure that the merge path is the single place where `state` is mutated, simplifying auditing and making it easier to add instrumentation.

4. **Error Handling**
   - Attach failure metadata including stack/trace when available and flag events with `status: 'error'`.
   - Aggregate an overall `toolExecutionStatus` object (success count, failure count, failures[]) that `agentLoop` can log or return.
   - Provide a hook (`scheduler?.onFailure`) so UI/observability layers can surface partial failures while other tools continue running.

5. **Streaming Compatibility**
   - Introduce an optional `onResult` callback that receives interim results as soon as a tool settles; this will be invoked from the `runInBatches` helper before merge.
   - Ensure callback invocations occur in settlement order but are explicitly documented as potentially out-of-order relative to final state writes.

6. **Backwards Compatibility**
   - Preserve existing function signature for default behaviour; only parallel-aware callers need to pass options or flagged intents.
   - Ensure unit tests continue to pass when `concurrency = 1`.
   - Provide a runtime guard to detect if any `ToolIntent` opts into `parallel` while `executeTools` is running in environments that disallow concurrency and fall back to sequential execution with a warning event.

## Implementation Steps
1. **Type Updates**
   - Update `ToolIntent` type definition to include optional `runMode`, `priority`, and `groupId`.
   - Add a `ParallelExecutionOptions` interface that mirrors the new options for `executeTools` and can be shared with higher-level APIs.
   - Document new fields in README and TypeDoc comments.

2. **Utility Extraction**
   - Refactor current `executeTools` loop into helper functions:
     - `resolveTool(toolIntent, tools)` – validates existence and returns tool instance.
     - `invokeTool(tool, args, abortSignal)` – wraps invocation with timing metadata and exposes cancellation for future streaming.
     - `buildToolEvent(result)` – normalizes the shape used by `agentMemory` and consumers.

3. **Parallel Execution Core**
   - Implement `executeToolBatch(intents, state, tools, options)` using `Promise.allSettled` to gather results.
   - Introduce a `scheduleIntents(intents, options)` planner that separates purely parallel groups from explicitly sequential segments.
   - Create deterministic `mergeToolResults(state, results, agentMemory)` that replays events through `agentMemory` in intent order.
   - Record metrics (counts, duration) via `options.scheduler?.onProgress?.(summary)`.

4. **API Surface Adjustments**
   - Allow `executeTools(toolIntents, state, tools, options?)` with optional `concurrency`, `onResult`, and `scheduler` callbacks.
   - Update `agentLoop` and any callsites to pass through the new options while defaulting to sequential behaviour.
   - Expose a top-level `createParallelScheduler` helper that can be reused by embedding applications to integrate with their tracing systems.

5. **Testing & Validation**
   - Add unit tests covering:
     - Mixed sequential + parallel batches.
     - Error propagation when a tool rejects.
     - Concurrency limit enforcement (e.g., ensure only `n` invocations run at once using mock tools).
     - Deterministic ordering of events in the state regardless of completion order.
     - `onResult` callback ordering and idempotence when listeners throw.
     - Fallback to sequential execution when concurrency is unsupported or dependencies require ordering.

6. **Documentation**
   - Update README usage examples to demonstrate opting into parallel execution.
   - Provide migration notes explaining defaults and safety considerations.
   - Add a troubleshooting section describing how to debug concurrency-related failures.

7. **Rollout Strategy**
   - Ship behind an opt-in feature flag for internal consumers first.
   - Capture telemetry to confirm success/failure rate parity before enabling broadly.
   - Publish a changelog entry summarizing behavioural changes and new configuration knobs.

## Open Questions
- Should we expose execution telemetry (start/end timestamps) on events or keep it internal until a telemetry subsystem exists?
- Do we need to support true dependency graphs (DAG) now, or is staged batching sufficient?
- How should we propagate partial tool results to streaming clients when `agentLoop` is in streaming mode?

## Risk Register & Mitigations
- **Race conditions in shared state** – Restrict all state mutations to the merge phase and add unit tests asserting deterministic event ordering.
- **Tool implementations assuming sequential execution** – Provide feature flag fallbacks and a migration guide; surface warnings when tools request sequential mode.
- **Resource exhaustion** – Default concurrency to 1 and require explicit opt-in; enforce an upper bound derived from configuration or environment heuristics.
- **Debuggability of failures** – Enhance logging with per-intent identifiers and batch IDs so operators can correlate failures to specific tool runs.

## Milestones & Rough Timeline
1. **Week 1 – Foundations**: Type updates, helper extraction, and sequential regression tests.
2. **Week 2 – Parallel core**: Implement scheduler/batching logic, add merge path, and land targeted unit tests.
3. **Week 3 – Observability & Docs**: Wire optional callbacks, add README + migration notes, and run integration tests against representative tool suites.
4. **Week 4 – Beta rollout**: Ship behind feature flag to internal agents, monitor telemetry, and gather feedback before public release.

