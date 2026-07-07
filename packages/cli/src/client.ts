/**
 * The daemon client: connect to the Unix socket, lazy-spawning sociusd if it is
 * not running, then speak newline-delimited JSON-RPC. Holds no intelligence.
 */
import { closeSync, existsSync, openSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  HandshakeResponse,
  InferNotification,
  InferParams,
  SociusConfig,
} from "@socius/core";
import { IPC_PROTOCOL_VERSION } from "@socius/core";

type Sock = ReturnType<typeof Bun.connect> extends Promise<infer S> ? S : never;

interface Pending {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

export interface MemoryListItem {
  id: string;
  kind: string;
  content: string;
  confidence: number;
  tags: string[];
  updatedAt: number;
}

export class DaemonClient {
  private buf = "";
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private onNotify: ((n: InferNotification) => void) | null = null;

  private constructor(private readonly socket: Sock) {}

  static async connect(socketPath: string): Promise<DaemonClient | null> {
    if (!existsSync(socketPath)) return null;
    try {
      let client!: DaemonClient;
      const socket = await Bun.connect({
        unix: socketPath,
        socket: {
          data: (_s, data: Uint8Array) => client.ingest(new TextDecoder().decode(data)),
          close: () => client.failAll(new Error("daemon closed the connection")),
          error: (_s, err: Error) => client.failAll(err),
        },
      });
      client = new DaemonClient(socket);
      return client;
    } catch {
      return null;
    }
  }

  private ingest(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { message: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.method === "notify") {
        this.onNotify?.(msg.params as InferNotification);
      } else if (msg.id !== undefined) {
        const p = this.pending.get(String(msg.id));
        if (!p) continue;
        this.pending.delete(String(msg.id));
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
    }
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private request<R>(method: string, params?: unknown): Promise<R> {
    const id = this.nextId++;
    return new Promise<R>((resolve, reject) => {
      this.pending.set(String(id), { resolve: resolve as (r: unknown) => void, reject });
      this.socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  handshake(): Promise<HandshakeResponse> {
    return this.request<HandshakeResponse>("handshake", {
      protocolVersion: IPC_PROTOCOL_VERSION,
      clientVersion: "0.0.0",
    });
  }

  health(): Promise<{ modelReady: boolean; modelId: string }> {
    return this.request("health");
  }

  /** Stream an inference. `onToken` fires per token; resolves when done. */
  async infer(params: InferParams, onToken: (text: string) => void): Promise<void> {
    this.onNotify = (n) => {
      if (n.kind === "token") onToken(n.text);
    };
    await this.request("infer", params);
    this.onNotify = null;
  }

  remember(content: string, kind?: string): Promise<{ id: string }> {
    return this.request("remember", { content, ...(kind ? { kind } : {}) });
  }

  memList(kinds?: string[], limit?: number): Promise<{ memories: MemoryListItem[] }> {
    return this.request("mem.list", { ...(kinds ? { kinds } : {}), ...(limit ? { limit } : {}) });
  }

  memForget(id: string): Promise<{ ok: boolean }> {
    return this.request("mem.forget", { id });
  }

  knowledgeIndex(): Promise<{ files: number; chunks: number }> {
    return this.request("knowledge.index");
  }

  knowledgeSearch(text: string): Promise<{ results: { content: string; ref?: string }[] }> {
    return this.request("knowledge.search", { text });
  }

  shutdown(): Promise<unknown> {
    return this.request("shutdown");
  }

  close(): void {
    this.socket.end();
  }
}

/**
 * Connect to the daemon, spawning it if absent. A lockfile serializes concurrent
 * spawns so two shells racing on a cold start do not launch two daemons.
 */
export async function ensureDaemon(config: SociusConfig): Promise<DaemonClient> {
  const socketPath = config.daemon.socketPath;
  const existing = await DaemonClient.connect(socketPath);
  if (existing) return existing;

  const lockPath = `${socketPath}.lock`;
  let haveLock = false;
  try {
    closeSync(openSync(lockPath, "wx"));
    haveLock = true;
  } catch {
    // another process is spawning; we will just wait for its socket.
  }

  if (haveLock) spawnDaemon();

  const deadline = Date.now() + config.inference.startupTimeoutMs + 10_000;
  try {
    while (Date.now() < deadline) {
      await Bun.sleep(300);
      const client = await DaemonClient.connect(socketPath);
      if (client) return client;
    }
    throw new Error("daemon did not become ready in time (model may still be loading)");
  } finally {
    if (haveLock) await rm(lockPath, { force: true }).catch(() => {});
  }
}

function spawnDaemon(): void {
  const daemonMain = join(import.meta.dir, "..", "..", "daemon", "src", "main.ts");
  const child = Bun.spawn([process.execPath, daemonMain], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: process.env,
  });
  child.unref();
}
