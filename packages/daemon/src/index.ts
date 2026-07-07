/**
 * @socius/daemon — sociusd. Owns the resident model (supervises llama-server),
 * wires the planner, and serves the CLI over a Unix socket. Lazy-spawned by the
 * CLI; idle-shuts-down after a configurable TTL.
 */
import type { Result, SociusConfig } from "@socius/core";
import { ok } from "@socius/core";
import { ConsoleLogger } from "@socius/logging";
import { Daemon } from "./daemon.ts";
import { LlamaModelRuntime } from "./runtime.ts";

export { Daemon } from "./daemon.ts";
export { type ModelRuntime, LlamaModelRuntime } from "./runtime.ts";

export function createDaemon(config: SociusConfig): Result<Daemon> {
  const logger = new ConsoleLogger({ level: config.logging.level, subsystem: "daemon" });
  const runtime = new LlamaModelRuntime(config, logger.child("inference"));
  return ok(new Daemon(config, logger, runtime));
}
