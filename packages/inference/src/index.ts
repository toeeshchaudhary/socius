/**
 * @socius/inference — the llama.cpp adapter. `sociusd` manages `llama-server`
 * as a child process (GPU for chat, a second CPU instance for embeddings) and
 * this module speaks its HTTP API behind the `InferenceBackend` / `Embedder`
 * interfaces. A remote OpenAI-compatible adapter can drop in later unchanged.
 *
 * M1 implements streaming `/completion`; this stub defines the surface.
 */
import type {
  BackendHealth,
  CompletionChunk,
  CompletionRequest,
  Embedder,
  InferenceBackend,
  Result,
} from "@socius/core";
import { error } from "@socius/core";

export interface LlamaServerOptions {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly contextWindow: number;
}

export class LlamaCppBackend implements InferenceBackend {
  readonly id = "llama.cpp";
  constructor(private readonly opts: LlamaServerOptions) {}

  async *complete(_req: CompletionRequest): AsyncIterable<CompletionChunk> {
    // M1: POST /completion with stream:true, yield SSE tokens.
    throw error("NOT_IMPLEMENTED", "inference", "LlamaCppBackend.complete (M1).");
  }

  async countTokens(_text: string): Promise<Result<number>> {
    return { ok: false, error: error("NOT_IMPLEMENTED", "inference", "countTokens (M1).") };
  }

  contextWindow(): number {
    return this.opts.contextWindow;
  }

  async health(): Promise<BackendHealth> {
    return { healthy: false, modelId: this.opts.modelId, contextWindow: this.opts.contextWindow, detail: "stub" };
  }
}

export class LlamaCppEmbedder implements Embedder {
  readonly id = "llama.cpp-embed";
  readonly dimensions: number;
  constructor(opts: { dimensions: number }) {
    this.dimensions = opts.dimensions;
  }
  async embed(_texts: readonly string[]): Promise<Result<readonly Float32Array[]>> {
    return { ok: false, error: error("NOT_IMPLEMENTED", "inference", "embed (M2).") };
  }
  async health(): Promise<BackendHealth> {
    return { healthy: false, modelId: this.id, contextWindow: 0, detail: "stub" };
  }
}
