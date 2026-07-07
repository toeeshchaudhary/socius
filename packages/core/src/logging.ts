/**
 * The Logging contract. Two streams: structured operational logs, and a
 * separate reasoning-trace stream that captures exactly what the model saw and
 * decided at each slot (prompt, raw output, validated output, latency, tokens).
 * Both are inspectable (Principle #5). Secrets are redacted at the sink.
 */
import type { Subsystem } from "./errors.ts";
import type { TraceId } from "./ids.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  child(subsystem: Subsystem): Logger;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** One LLM interaction, recorded verbatim for `socius trace`. */
export interface ReasoningTrace {
  readonly traceId: TraceId;
  readonly slot: string;
  readonly prompt: string;
  readonly rawOutput: string;
  readonly validatedOutput?: unknown;
  readonly valid: boolean;
  readonly latencyMs: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
}

export interface TraceSink {
  record(trace: ReasoningTrace): void;
}
