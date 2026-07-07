/**
 * The Intelligence contract. Everything above this interface is model-agnostic:
 * swap Gemma for another local model, or for a remote OpenAI-compatible endpoint,
 * without touching the planner, memory, or tools (Principle #6).
 *
 * Two distinct capabilities, deliberately separated because on a 4 GB GPU they
 * cannot co-reside: `InferenceBackend` (chat/reasoning, GPU) and `Embedder`
 * (vectors, CPU).
 */
import type { Result } from "./result.ts";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface CompletionRequest {
  readonly messages: readonly ChatMessage[];
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly stop?: readonly string[];
  /** A JSON Schema the backend must constrain output to (grammar / GBNF). */
  readonly responseSchema?: unknown;
  /** Abort mid-stream. */
  readonly signal?: AbortSignal;
}

export interface CompletionChunk {
  readonly type: "token" | "done";
  readonly text: string;
}

export interface Usage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface BackendHealth {
  readonly healthy: boolean;
  readonly modelId: string;
  readonly contextWindow: number;
  readonly detail?: string;
}

export interface InferenceBackend {
  readonly id: string;
  /** Stream a completion token-by-token. */
  complete(req: CompletionRequest): AsyncIterable<CompletionChunk>;
  /** Count tokens for a string under this backend's tokenizer. */
  countTokens(text: string): Promise<Result<number>>;
  contextWindow(): number;
  health(): Promise<BackendHealth>;
}

export interface Embedder {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<Result<readonly Float32Array[]>>;
  health(): Promise<BackendHealth>;
}
