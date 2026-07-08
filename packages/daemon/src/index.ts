/**
 * @socius/daemon — sociusd. Owns the resident model (supervises llama-server),
 * wires the planner, and serves the CLI over a Unix socket. Lazy-spawned by the
 * CLI; idle-shuts-down after a configurable TTL.
 */
import type { Result, SociusConfig } from "@socius/core";
import { ok } from "@socius/core";
import { HashingEmbedder } from "@socius/inference";
import { ConsoleLogger } from "@socius/logging";
import { Daemon } from "./daemon.ts";
import { createRuntime } from "./runtime.ts";

export { Daemon } from "./daemon.ts";
export {
  type ModelRuntime,
  LlamaModelRuntime,
  RemoteModelRuntime,
  createRuntime,
} from "./runtime.ts";

export function createDaemon(config: SociusConfig): Result<Daemon> {
  const logger = new ConsoleLogger({ level: config.logging.level, subsystem: "daemon" });
  const runtime = createRuntime(config, logger.child("inference"));
  // No embedding model is configured by default, so use the model-free hashing
  // embedder. Configuring a real embedding GGUF swaps in LlamaCppEmbedder.
  const embedder = new HashingEmbedder(256);
  return ok(new Daemon(config, logger, runtime, embedder));
}
