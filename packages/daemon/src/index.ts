/**
 * @socius/daemon — sociusd. Owns the resident model (manages llama-server child
 * processes), wires every subsystem, and serves the CLI over a Unix socket
 * (newline-delimited JSON-RPC). Lazy-spawned by the CLI; idle-shuts-down after
 * a configurable TTL.
 *
 * M1 implements: socket server, handshake, infer streaming, llama-server child
 * management + health/restart, idle timeout, pidfile. This module currently
 * exposes the lifecycle surface.
 */
import type { SociusConfig } from "@socius/core";
import { type Result, error } from "@socius/core";

export interface Daemon {
  /** Bind the socket, start the model, write the pidfile. */
  start(): Promise<Result<void>>;
  /** Graceful shutdown: drain requests, stop children, unlink socket + pidfile. */
  stop(): Promise<void>;
}

export function createDaemon(_config: SociusConfig): Result<Daemon> {
  return { ok: false, error: error("NOT_IMPLEMENTED", "daemon", "createDaemon (M1).") };
}
