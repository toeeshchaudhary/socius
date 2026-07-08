/**
 * @socius/inference — the llama.cpp adapter. `sociusd` supervises `llama-server`
 * as a child process (GPU for chat; a second CPU instance for embeddings in M2)
 * and this module speaks its HTTP API behind the `InferenceBackend` / `Embedder`
 * interfaces. `OpenAICompatBackend` is the remote counterpart: any OpenAI-style
 * gateway (Vercel AI Gateway, OpenRouter, Groq, …) behind the same interface.
 */
export { LlamaCppBackend, type LlamaCppBackendOptions } from "./backend.ts";
export {
  OpenAICompatBackend,
  type OpenAICompatBackendOptions,
  GATEWAYS,
  type GatewayPreset,
  checkApiKey,
  type KeyCheckResult,
} from "./openai-compat.ts";
export { LlamaServerProcess, type LlamaServerOptions } from "./llama-server.ts";
export {
  LlamaCppEmbedder,
  type LlamaCppEmbedderOptions,
  HashingEmbedder,
} from "./embedder.ts";
