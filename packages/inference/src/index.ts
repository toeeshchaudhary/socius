/**
 * @socius/inference — the llama.cpp adapter. `sociusd` supervises `llama-server`
 * as a child process (GPU for chat; a second CPU instance for embeddings in M2)
 * and this module speaks its HTTP API behind the `InferenceBackend` / `Embedder`
 * interfaces. A remote OpenAI-compatible adapter can drop in later unchanged.
 */
export { LlamaCppBackend, type LlamaCppBackendOptions } from "./backend.ts";
export { LlamaServerProcess, type LlamaServerOptions } from "./llama-server.ts";
export {
  LlamaCppEmbedder,
  type LlamaCppEmbedderOptions,
  HashingEmbedder,
} from "./embedder.ts";
