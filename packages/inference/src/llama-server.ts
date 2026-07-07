/**
 * Supervises a `llama-server` child process. The daemon owns this: spawn the
 * model, wait for /health, restart on crash with backoff. Keeping the CUDA
 * runtime out-of-process means a model segfault is a child exit we recover from,
 * not a daemon crash (Principle #2).
 */
import { openSync } from "node:fs";
import type { Logger } from "@socius/core";

export interface LlamaServerOptions {
  readonly bin: string;
  readonly modelPath: string;
  readonly host: string;
  readonly port: number;
  readonly contextWindow: number;
  readonly gpuLayers: number;
  readonly startupTimeoutMs: number;
  /** Run in embedding mode (CPU), used by the M2 embedder. */
  readonly embeddings?: boolean;
  /** Force CPU-only (gpuLayers ignored). */
  readonly cpuOnly?: boolean;
  /** If set, child stdout+stderr are appended here instead of discarded. */
  readonly logFile?: string;
  readonly logger: Logger;
}

export class LlamaServerProcess {
  private proc: Bun.Subprocess | null = null;
  private restarts = 0;
  private stopping = false;
  private readonly baseUrlValue: string;

  constructor(private readonly opts: LlamaServerOptions) {
    this.baseUrlValue = `http://${opts.host}:${opts.port}`;
  }

  get baseUrl(): string {
    return this.baseUrlValue;
  }

  private args(): string[] {
    const a = [
      "-m", this.opts.modelPath,
      "--host", this.opts.host,
      "--port", String(this.opts.port),
      "-c", String(this.opts.contextWindow),
      "-ngl", String(this.opts.cpuOnly ? 0 : this.opts.gpuLayers),
    ];
    if (this.opts.embeddings) a.push("--embeddings");
    return a;
  }

  async start(): Promise<void> {
    this.stopping = false;
    this.spawn();
    await this.waitForHealth();
  }

  private spawn(): void {
    this.opts.logger.info("spawning llama-server", {
      port: this.opts.port,
      ngl: this.opts.cpuOnly ? 0 : this.opts.gpuLayers,
      embeddings: this.opts.embeddings ?? false,
    });
    const sink = this.opts.logFile ? openSync(this.opts.logFile, "a") : "ignore";
    this.proc = Bun.spawn([this.opts.bin, ...this.args()], {
      stdout: sink,
      stderr: sink,
      onExit: (_p, code) => {
        this.proc = null;
        if (this.stopping) return;
        this.opts.logger.warn("llama-server exited unexpectedly", { code, restarts: this.restarts });
        this.restartWithBackoff();
      },
    });
  }

  private restartWithBackoff(): void {
    this.restarts += 1;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.restarts, 6));
    setTimeout(() => {
      if (this.stopping) return;
      this.spawn();
    }, delay);
  }

  /** Poll /health until the model reports ready or the startup timeout elapses. */
  private async waitForHealth(): Promise<void> {
    const deadline = Date.now() + this.opts.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (await this.healthy()) {
        this.restarts = 0;
        this.opts.logger.info("llama-server healthy", { port: this.opts.port });
        return;
      }
      await Bun.sleep(500);
    }
    throw new Error(`llama-server did not become healthy within ${this.opts.startupTimeoutMs}ms`);
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrlValue}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const p = this.proc;
    if (!p) return;
    p.kill("SIGTERM");
    const timeout = Bun.sleep(3000).then(() => "timeout" as const);
    const exited = p.exited.then(() => "exited" as const);
    if ((await Promise.race([exited, timeout])) === "timeout") p.kill("SIGKILL");
    this.proc = null;
  }
}
