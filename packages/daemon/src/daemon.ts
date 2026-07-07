/**
 * sociusd — owns the resident model, wires the planner, and serves the CLI over
 * a Unix socket. Lazy-spawned by the CLI; idle-shuts-down after a TTL.
 */
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  Embedder,
  HandshakeRequest,
  HandshakeResponse,
  InferParams,
  Logger,
  MemoryKind,
  MemoryStore,
  RequestId,
  SociusConfig,
  TraceId,
} from "@socius/core";
import { IPC_PROTOCOL_VERSION, asMemoryId, asRequestId, asTraceId } from "@socius/core";
import { SqliteMemoryStore } from "@socius/memory";
import { DirectPlanner } from "@socius/planner";
import { SociusDatabase } from "@socius/storage";
import { loadSystemPrompt } from "./prompts.ts";
import type { ModelRuntime } from "./runtime.ts";
import { LineBuffer, type WireRequest, errorResponse, notify, response } from "./rpc.ts";

interface ConnState {
  buffer: LineBuffer;
  current: AbortController | null;
}

interface RememberParams {
  content: string;
  kind?: string;
  origin?: string;
  tags?: string[];
}
interface MemListParams {
  kinds?: string[];
  limit?: number;
}

// biome-ignore lint/suspicious/noExplicitAny: Bun.Socket generic varies by version
type Sock = any;

export class Daemon {
  private server: ReturnType<typeof Bun.listen> | null = null;
  private modelReady = false;
  private planner: DirectPlanner | null = null;
  private memory: MemoryStore | null = null;
  private database: SociusDatabase | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private readonly conns = new WeakMap<object, ConnState>();

  constructor(
    private readonly config: SociusConfig,
    private readonly log: Logger,
    private readonly runtime: ModelRuntime,
    private readonly embedder?: Embedder,
  ) {}

  async start(): Promise<void> {
    const { socketPath, pidPath } = this.config.daemon;
    await mkdir(dirname(socketPath), { recursive: true });
    await mkdir(this.config.logging.dir, { recursive: true });
    await writeFile(pidPath, String(process.pid));

    // Bring up the model first so the handshake can report modelReady honestly.
    await this.runtime.start();
    this.modelReady = true;

    // Memory is optional: if an embedder is provided, open the DB and wire the
    // store. A failure here degrades gracefully — the daemon still answers.
    if (this.embedder) {
      await mkdir(dirname(this.config.storage.dbFile), { recursive: true });
      const opened = await SociusDatabase.open(this.config.storage.dbFile, this.embedder.dimensions);
      if (opened.ok) {
        this.database = opened.value;
        this.memory = new SqliteMemoryStore(opened.value, this.embedder, {
          confidenceHalfLifeDays: this.config.memory.confidenceHalfLifeDays,
          defaultK: this.config.memory.defaultK,
          defaultTokenBudget: this.config.memory.defaultTokenBudget,
        });
        this.log.info("memory ready", { db: this.config.storage.dbFile });
      } else {
        this.log.warn("memory disabled", { err: opened.error.message });
      }
    }

    const systemPrompt = await loadSystemPrompt(this.config.promptsDir);
    this.planner = new DirectPlanner({
      backend: this.runtime.backend(),
      systemPrompt,
      ...(this.memory
        ? { memory: this.memory, memoryTokenBudget: this.config.memory.defaultTokenBudget }
        : {}),
    });

    // A stale socket file from a previous crash would make bind fail; the CLI's
    // spawn-lock guarantees we are the only daemon starting, so it is safe to clear.
    if (existsSync(socketPath)) await rm(socketPath, { force: true });
    this.serve(socketPath);
    this.armIdleTimer();
    this.installSignalHandlers();
    this.log.info("sociusd ready", { socket: socketPath, model: this.config.model.id });
  }

  private serve(socketPath: string): void {
    this.server = Bun.listen({
      unix: socketPath,
      socket: {
        open: (socket: Sock) => {
          this.conns.set(socket, { buffer: new LineBuffer(), current: null });
        },
        data: (socket: Sock, data: Uint8Array) => {
          const state = this.conns.get(socket);
          if (!state) return;
          for (const msg of state.buffer.push(new TextDecoder().decode(data))) {
            void this.dispatch(socket, state, msg);
          }
        },
        close: (socket: Sock) => {
          this.conns.get(socket)?.current?.abort();
          this.conns.delete(socket);
        },
        error: (socket: Sock, err: Error) => {
          this.log.warn("socket error", { err: err.message });
          this.conns.delete(socket);
        },
      },
    });
  }

  private async dispatch(socket: Sock, state: ConnState, msg: WireRequest): Promise<void> {
    this.touchIdle();
    const id = msg.id ?? (asRequestId("0") as RequestId);
    try {
      switch (msg.method) {
        case "handshake":
          socket.write(response(id, this.handshake(msg.params as HandshakeRequest)));
          break;
        case "infer":
          await this.infer(socket, state, id, msg.params as InferParams);
          break;
        case "cancel":
          state.current?.abort();
          socket.write(response(id, { cancelled: true }));
          break;
        case "health":
          socket.write(response(id, await this.health()));
          break;
        case "remember":
          socket.write(response(id, await this.remember(msg.params as RememberParams)));
          break;
        case "mem.list":
          socket.write(response(id, await this.memList(msg.params as MemListParams)));
          break;
        case "mem.forget":
          socket.write(response(id, await this.memForget((msg.params as { id: string }).id)));
          break;
        case "shutdown":
          socket.write(response(id, { ok: true }));
          await this.stop();
          process.exit(0);
          break;
        default:
          socket.write(errorResponse(id, -32601, `unknown method: ${msg.method}`));
      }
    } catch (err) {
      socket.write(errorResponse(id, -32000, err instanceof Error ? err.message : String(err)));
    }
  }

  private handshake(_params: HandshakeRequest): HandshakeResponse {
    return {
      protocolVersion: IPC_PROTOCOL_VERSION,
      daemonVersion: "0.0.0",
      modelReady: this.modelReady,
      modelId: this.config.model.id,
    };
  }

  private async infer(
    socket: Sock,
    state: ConnState,
    id: RequestId,
    params: InferParams,
  ): Promise<void> {
    if (!this.planner) {
      socket.write(errorResponse(id, -32000, "planner not ready"));
      return;
    }
    const controller = new AbortController();
    state.current = controller;
    this.seq += 1;
    const ctx = {
      requestId: asRequestId(`r${this.seq}`),
      traceId: asTraceId(`t${this.seq}`) as TraceId,
      input: params.input,
      ...(params.stdin ? { stdin: params.stdin } : {}),
      ...(params.maxTokens ? { maxTokens: params.maxTokens } : {}),
      signal: controller.signal,
    };
    try {
      for await (const ev of this.planner.run(ctx)) {
        if (ev.type === "token" && ev.token) socket.write(notify({ kind: "token", text: ev.token }));
        else if (ev.type === "step" && ev.step) socket.write(notify({ kind: "step", label: ev.step.label }));
      }
      socket.write(notify({ kind: "done" }));
      socket.write(response(id, { ok: true }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      socket.write(errorResponse(id, -32000, message));
    } finally {
      state.current = null;
    }
  }

  private async health(): Promise<{ modelReady: boolean; modelId: string; memory: boolean }> {
    const h = await this.runtime.backend().health();
    return { modelReady: h.healthy, modelId: this.config.model.id, memory: this.memory !== null };
  }

  private async remember(params: RememberParams): Promise<{ id: string }> {
    if (!this.memory) throw new Error("memory is not available");
    const r = await this.memory.remember({
      kind: (params.kind ?? "long_term") as MemoryKind,
      content: params.content,
      source: { origin: params.origin ?? "user" },
      ...(params.tags ? { tags: params.tags } : {}),
    });
    if (!r.ok) throw r.error;
    return { id: r.value.id };
  }

  private async memList(params: MemListParams): Promise<{ memories: unknown[] }> {
    if (!this.memory) throw new Error("memory is not available");
    const r = await this.memory.list({
      ...(params.kinds ? { kinds: params.kinds as MemoryKind[] } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    });
    if (!r.ok) throw r.error;
    return {
      memories: r.value.map((m) => ({
        id: m.id,
        kind: m.kind,
        content: m.content,
        confidence: m.confidence,
        tags: m.tags,
        updatedAt: m.updatedAt,
      })),
    };
  }

  private async memForget(id: string): Promise<{ ok: boolean }> {
    if (!this.memory) throw new Error("memory is not available");
    const r = await this.memory.forget(asMemoryId(id));
    if (!r.ok) throw r.error;
    return { ok: true };
  }

  private armIdleTimer(): void {
    this.touchIdle();
  }

  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.log.info("idle timeout reached, shutting down");
      void this.stop().then(() => process.exit(0));
    }, this.config.daemon.idleTimeoutMs);
  }

  private installSignalHandlers(): void {
    const onSignal = () => void this.stop().then(() => process.exit(0));
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
  }

  async stop(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.server?.stop();
    await this.runtime.stop();
    this.database?.close();
    await rm(this.config.daemon.socketPath, { force: true }).catch(() => {});
    await rm(this.config.daemon.pidPath, { force: true }).catch(() => {});
    this.log.info("sociusd stopped");
  }
}
