/**
 * @socius/inference — the llama.cpp adapter. `sociusd` supervises `llama-server`
 * as a child process (GPU for chat; a second CPU instance for embeddings in M2)
 * and this module speaks its HTTP API behind the `InferenceBackend` / `Embedder`
 * interfaces. A remote OpenAI-compatible adapter can drop in later unchanged.
 */
import type { BackendHealth, Embedder, Result } from "@socius/core";
import { error } from "@socius/core";

export { LlamaCppBackend, type LlamaCppBackendOptions } from "./backend.ts";
export { LlamaServerProcess, type LlamaServerOptions } from "./llama-server.ts";

/** M2: a CPU-pinned llama-server `--embeddings` instance behind this interface. */
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
