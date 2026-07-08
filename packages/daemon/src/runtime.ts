/**
 * The model runtime seam. The daemon depends on this interface, not on
 * llama-server directly, so the whole IPC/streaming path can be tested in-process
 * with a fake backend (no GPU, no child process) — and so a different inference
 * runtime can be dropped in later.
 */
import type { InferenceBackend, Logger, SociusConfig } from "@socius/core";
import {
  GATEWAYS,
  LlamaCppBackend,
  LlamaServerProcess,
  OpenAICompatBackend,
} from "@socius/inference";

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
      thinking: config.inference.thinking,
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

/**
 * Remote runtime: no child process to supervise — the "model" is an OpenAI-
 * compatible gateway. start() is a health probe so a bad key/url fails fast
 * with a readable error instead of a mid-query 401.
 */
export class RemoteModelRuntime implements ModelRuntime {
  private be: OpenAICompatBackend;

  constructor(config: SociusConfig, logger: Logger) {
    const remote = config.inference.remote;
    if (!remote) {
      throw new Error('inference.backend = "remote" but [inference.remote] is not configured');
    }
    const preset = GATEWAYS[remote.gateway];
    const baseUrl = remote.baseUrl ?? preset?.baseUrl;
    if (!baseUrl) {
      throw new Error(
        `unknown gateway '${remote.gateway}' (known: ${Object.keys(GATEWAYS).join(", ")}, or set baseUrl for a custom one)`,
      );
    }
    // Key resolution: explicit apiKey ‹ stored key (socius key set) ‹ env var.
    const apiKey =
      remote.apiKey ||
      config.keys[remote.gateway] ||
      (preset ? (process.env[preset.keyEnv] ?? "") : "");
    if (!apiKey) {
      const envHint = preset ? ` or export ${preset.keyEnv}` : "";
      throw new Error(
        `no API key for gateway '${remote.gateway}' — run 'socius key set ${remote.gateway} <key>'${envHint}`,
      );
    }
    logger.info("using remote inference", { gateway: remote.gateway, model: remote.model });
    this.be = new OpenAICompatBackend({
      baseUrl,
      apiKey,
      modelId: remote.model,
      contextWindow: remote.contextWindow ?? 32768,
      thinking: config.inference.thinking,
      ...(preset?.noThinkBody ? { noThinkBody: preset.noThinkBody } : {}),
    });
  }

  async start(): Promise<void> {
    const h = await this.be.health();
    if (!h.healthy) {
      throw new Error(`remote gateway unhealthy: ${h.detail ?? "unknown"}`);
    }
  }
  async stop(): Promise<void> {}
  backend(): InferenceBackend {
    return this.be;
  }
}

/** Pick the runtime for the configured backend. */
export function createRuntime(config: SociusConfig, logger: Logger): ModelRuntime {
  return config.inference.backend === "remote"
    ? new RemoteModelRuntime(config, logger)
    : new LlamaModelRuntime(config, logger);
}
