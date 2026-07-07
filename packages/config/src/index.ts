/**
 * @socius/config — layered config loader (defaults ‹ config.toml ‹ env ‹ flags),
 * validated with zod. The full schema + TOML parsing land in M1; this module
 * exposes path resolution and the defaults now.
 */
import type { SociusConfig } from "@socius/core";
import { type SociusPaths, resolvePaths } from "./paths.ts";

export { resolvePaths, type SociusPaths } from "./paths.ts";

/** Built-in defaults, tuned for the 4 GB-VRAM reference machine. */
export function defaultConfig(paths: SociusPaths = resolvePaths()): SociusConfig {
  return {
    model: {
      id: "gemma-3n-e4b-q4_k_m",
      path: "",
      contextWindow: 8192,
      gpuLayers: 999,
    },
    inference: {
      llamaServerBin: `${process.env.HOME}/llama.cpp/build/bin/llama-server`,
      host: "127.0.0.1",
      port: 8080,
      startupTimeoutMs: 30_000,
      embedder: {
        id: "bge-small-en-v1.5-q8",
        path: "",
        port: 8081,
        cpuOnly: true,
      },
    },
    daemon: {
      socketPath: paths.socketPath,
      pidPath: paths.pidPath,
      idleTimeoutMs: 30 * 60_000,
    },
    memory: {
      defaultK: 12,
      defaultTokenBudget: 1024,
      confidenceHalfLifeDays: 30,
    },
    permissions: {
      // Tools execute for real by default, but the policy below forces an
      // interactive confirm on anything that writes, executes, or hits the net.
      defaultMode: "live",
      policy: {
        "fs.read": "allow",
        "fs.write": "confirm",
        "fs.delete": "confirm",
        net: "confirm",
        exec: "confirm",
        secrets: "deny",
      },
    },
    logging: {
      level: "info",
      dir: paths.stateDir,
      traces: true,
    },
    mcp: [],
    promptsDir: paths.promptsDir,
  };
}
