/**
 * The Planner contract. The planner is a deterministic state graph written in
 * TypeScript; the LLM is invoked only at "slot" nodes with a constrained,
 * schema-validated output. Control flow is code, not model autonomy — this is
 * what makes Socius reliable on a small local model (Principle #4).
 *
 * A future `AutonomousPlanner` can implement this same interface for larger
 * backends without changing the daemon.
 */
import type { RequestId, TraceId } from "./ids.ts";
import type { RetrievedMemory } from "./memory.ts";

export type PlanNodeKind =
  | "classify"
  | "retrieve"
  | "plan"
  | "confirm"
  | "tool_call"
  | "reflect"
  | "summarize"
  | "answer";

/** One recorded step in a plan execution — the basis of an inspectable trace. */
export interface PlanStep {
  readonly node: PlanNodeKind;
  readonly label: string;
  readonly detail?: string;
  readonly startedAt: number;
  readonly durationMs: number;
}

export interface PlanContext {
  readonly requestId: RequestId;
  readonly traceId: TraceId;
  readonly input: string;
  /** Piped stdin content, if any (git diff, logs, …). */
  readonly stdin?: string;
  readonly memories?: readonly RetrievedMemory[];
  readonly signal?: AbortSignal;
}

export interface PlanEvent {
  readonly type: "step" | "token" | "confirm" | "error" | "done";
  readonly step?: PlanStep;
  readonly token?: string;
  readonly message?: string;
}

/**
 * Executes a request as a bounded graph traversal, streaming events as it goes.
 * Depth and step count are capped by config — no open-ended while-loops.
 */
export interface Planner {
  run(ctx: PlanContext): AsyncIterable<PlanEvent>;
}
