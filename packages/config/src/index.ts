/**
 * @socius/config — layered config loader (defaults ‹ config.toml ‹ env ‹ flags),
 * validated with zod. The full schema + TOML parsing land in M1; this module
 * exposes path resolution and the defaults now.
 */
import type { SociusConfig } from "@socius/core";
import { type SociusPaths, resolvePaths } from "./paths.ts";

export { resolvePaths, type SociusPaths } from "./paths.ts";
export { loadConfig } from "./load.ts";

/** Built-in defaults, tuned for the 4 GB-VRAM reference machine. */
export function defaultConfig(paths: SociusPaths = resolvePaths()): SociusConfig {
  return {
    model: {
      id: "gemma-4-e4b-it-q4_k_m",
      path: `${process.env.HOME}/AI/models/gemma-4-E4B-it-Q4_K_M.gguf`,
      contextWindow: 4096,
      // This model's Q4_K_M weights (~5 GB) exceed the 4 GB VRAM, so full offload
      // OOMs. And *partial* offload of this E-series (gemma-3n/E4B) arch trips
      // llama.cpp's GGML_SCHED_MAX_SPLIT_INPUTS assert (too many GPU/CPU boundary
      // tensors) and crashes. So the only reliable config for THIS model on THIS
      // GPU is CPU-only. A smaller model or quant that fits 4 GB can raise this.
      gpuLayers: 0,
    },
    inference: {
      llamaServerBin: `${process.env.HOME}/llama.cpp/build/bin/llama-server`,
      host: "127.0.0.1",
      port: 8080,
      // CPU-only load of a 5 GB model + graph reserve can take a while on first
      // start; be generous so the CLI doesn't give up before the model is ready.
      startupTimeoutMs: 120_000,
      thinking: false,
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
    storage: {
      dbFile: paths.dbFile,
      knowledgeDir: paths.knowledgeDir,
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
    schedules: [],
    promptsDir: paths.promptsDir,
  };
}
