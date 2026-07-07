/**
 * The model runtime seam. The daemon depends on this interface, not on
 * llama-server directly, so the whole IPC/streaming path can be tested in-process
 * with a fake backend (no GPU, no child process) — and so a different inference
 * runtime can be dropped in later.
 */
import type { InferenceBackend, Logger, SociusConfig } from "@socius/core";
import { LlamaCppBackend, LlamaServerProcess } from "@socius/inference";

export interface ModelRuntime {
  /** Bring the model up (spawn + health-check). */
  start(): Promise<void>;
  /** Tear it down. */
  stop(): Promise<void>;
  /** The backend the planner reasons through. */
  backend(): InferenceBackend;
}

/** Production runtime: supervises llama-server and talks to it over HTTP. */
export class LlamaModelRuntime implements ModelRuntime {
  private proc: LlamaServerProcess;
  private be: LlamaCppBackend;

  constructor(config: SociusConfig, logger: Logger) {
    this.proc = new LlamaServerProcess({
      bin: config.inference.llamaServerBin,
      modelPath: config.model.path,
      host: config.inference.host,
      port: config.inference.port,
      contextWindow: config.model.contextWindow,
      gpuLayers: config.model.gpuLayers,
      startupTimeoutMs: config.inference.startupTimeoutMs,
      logFile: `${config.logging.dir}/llama-server.log`,
      logger,
    });
    this.be = new LlamaCppBackend({
      baseUrl: this.proc.baseUrl,
      modelId: config.model.id,
      contextWindow: config.model.contextWindow,
    });
  }

  start(): Promise<void> {
    return this.proc.start();
  }
  stop(): Promise<void> {
    return this.proc.stop();
  }
  backend(): InferenceBackend {
    return this.be;
  }
}
