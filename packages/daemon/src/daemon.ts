/**
 * sociusd — owns the resident model, wires the planner, and serves the CLI over
 * a Unix socket. Lazy-spawned by the CLI; idle-shuts-down after a TTL.
 */
import { type FSWatcher, existsSync, watch } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { loadConfig, resolvePaths } from "@socius/config";
import type {
  ConfirmationProvider,
  Embedder,
  HandshakeRequest,
  HandshakeResponse,
  InferParams,
  Logger,
  MemoryKind,
  MemoryStore,
  PermissionRequest,
  PolicyEngine,
  RequestId,
  Result,
  SociusConfig,
  ToolRegistry,
  TraceId,
  TraceSink,
} from "@socius/core";
import { IPC_PROTOCOL_VERSION, asMemoryId, asRequestId, asTraceId, ok } from "@socius/core";
import { indexKnowledge } from "@socius/knowledge";
import { FileTraceSink, NullTraceSink } from "@socius/logging";
import { McpManager } from "@socius/mcp";
import { SqliteMemoryStore } from "@socius/memory";
import { ConfiguredPolicyEngine } from "@socius/permissions";
import { GraphPlanner } from "@socius/planner";
import { SociusDatabase } from "@socius/storage";
import { InMemoryToolRegistry, ToolRunner, builtinTools } from "@socius/tools";
import { loadSystemPrompt } from "./prompts.ts";
import { LineBuffer, type WireRequest, errorResponse, notify, response } from "./rpc.ts";
import type { ModelRuntime } from "./runtime.ts";

interface ConnState {
  buffer: LineBuffer;
  current: AbortController | null;
  confirmer: IpcConfirmer | null;
}

/**
 * Bridges a tool's confirmation request to the CLI over the socket: emits a
 * `confirm` notification and awaits the client's `confirm.response`. This is how
 * Principle #3 is enforced interactively — a destructive tool blocks here until
 * the user answers, and there is no path around it.
 */
class IpcConfirmer implements ConfirmationProvider {
  private readonly pending = new Map<string, (approved: boolean) => void>();
  private counter = 0;
  constructor(private readonly socket: Sock) {}

  confirm(req: PermissionRequest): Promise<Result<boolean>> {
    const id = `cf${++this.counter}`;
    const resources = req.resources?.length ? ` [${req.resources.join(", ")}]` : "";
    const prompt = `${req.toolName}${resources} — ${req.reasoning}`;
    return new Promise((resolve) => {
      this.pending.set(id, (approved) => resolve(ok(approved)));
      this.socket.write(notify({ kind: "confirm", id, prompt }));
    });
  }

  resolve(id: string, approved: boolean): void {
    const fn = this.pending.get(id);
    if (fn) {
      this.pending.delete(id);
      fn(approved);
    }
  }

  /** Deny any still-pending confirmations (e.g. connection closed mid-prompt). */
  denyAll(): void {
    for (const fn of this.pending.values()) fn(false);
    this.pending.clear();
  }
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
  private registry: ToolRegistry | null = null;
  private policy: PolicyEngine | null = null;
  private systemPrompt = "";
  private memory: MemoryStore | null = null;
  private database: SociusDatabase | null = null;
  private mcp: McpManager | null = null;
  private traceSink: TraceSink = new NullTraceSink();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private readonly conns = new WeakMap<object, ConnState>();
  private readonly watchers: FSWatcher[] = [];
  private readonly debounces = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly scheduleTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private config: SociusConfig,
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
      const opened = await SociusDatabase.open(
        this.config.storage.dbFile,
        this.embedder.dimensions,
      );
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

    // Tools + permissions: a registry of native tools and the policy engine.
    // The ToolRunner + planner are built per-request in infer() so each can carry
    // a confirmer bound to that connection's socket (interactive confirmation).
    const registry = new InMemoryToolRegistry();
    for (const t of builtinTools()) registry.register(t);

    // MCP tools are wrapped as native Tools and registered into the same
    // registry — the planner cannot tell them apart. Resilient: a server that
    // fails to start is skipped, native tools keep working.
    if (this.config.mcp.some((s) => s.enabled)) {
      this.mcp = new McpManager(this.log.child("mcp"));
      await this.mcp.connectAll(this.config.mcp, registry);
    }

    this.registry = registry;
    this.policy = new ConfiguredPolicyEngine(this.config.permissions.policy, {
      ...(this.config.permissions.tools ? { tools: this.config.permissions.tools } : {}),
      ...(this.config.permissions.paths ? { paths: [...this.config.permissions.paths] } : {}),
    });
    this.systemPrompt = await loadSystemPrompt(this.config.promptsDir);
    if (this.config.logging.traces) {
      this.traceSink = new FileTraceSink(join(this.config.logging.dir, "traces.jsonl"));
    }

    // A stale socket file from a previous crash would make bind fail; the CLI's
    // spawn-lock guarantees we are the only daemon starting, so it is safe to clear.
    if (existsSync(socketPath)) await rm(socketPath, { force: true });
    this.serve(socketPath);
    this.armIdleTimer();
    this.installSignalHandlers();
    this.setupWatchers();
    this.setupSchedules();
    const model =
      this.config.inference.backend === "remote"
        ? (this.config.inference.remote?.model ?? "remote")
        : this.config.model.id;
    this.log.info("sociusd ready", { socket: socketPath, model });
  }

  // --- Scheduled background tasks (M6) ---

  private setupSchedules(): void {
    for (const s of this.config.schedules) {
      if (!s.enabled) continue;
      if (s.everyMinutes && s.everyMinutes > 0) {
        this.scheduleTimers.push(
          setInterval(() => void this.runSchedule(s.name), s.everyMinutes * 60_000),
        );
        this.log.info("schedule armed", { name: s.name, everyMinutes: s.everyMinutes });
      } else if (s.dailyAt) {
        this.armDaily(s.name, s.dailyAt);
      }
    }
  }

  private armDaily(name: string, hhmm: string): void {
    const [h, m] = hhmm.split(":").map(Number);
    if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return;
    const now = new Date();
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    this.scheduleTimers.push(
      setTimeout(() => {
        void this.runSchedule(name);
        this.armDaily(name, hhmm); // reschedule for tomorrow
      }, delay),
    );
    this.log.info("schedule armed", { name, dailyAt: hhmm, inMinutes: Math.round(delay / 60_000) });
  }

  private async runSchedule(name: string): Promise<string> {
    const s = this.config.schedules.find((x) => x.name === name);
    if (!s) throw new Error(`no schedule '${name}'`);
    this.log.info("running schedule", { name });
    const answer = await this.runInternal(s.prompt);
    if (s.notify !== false) this.notify(`Socius — ${name}`, answer.slice(0, 400) || "(no output)");
    return answer;
  }

  /** Run a prompt through the planner with no client (destructive tools auto-fail). */
  private async runInternal(input: string): Promise<string> {
    if (!this.registry || !this.policy) return "";
    const runner = new ToolRunner(this.policy); // no confirmer -> confirm-required tools fail safely
    const planner = new GraphPlanner({
      backend: this.runtime.backend(),
      systemPrompt: this.systemPrompt,
      tools: this.registry,
      runner,
      mode: this.config.permissions.defaultMode,
      traceSink: this.traceSink,
      ...(this.memory
        ? { memory: this.memory, memoryTokenBudget: this.config.memory.defaultTokenBudget }
        : {}),
    });
    this.seq += 1;
    let out = "";
    for await (const ev of planner.run({
      requestId: asRequestId(`sched${this.seq}`),
      traceId: asTraceId(`sched${this.seq}`) as TraceId,
      input,
    })) {
      if (ev.type === "token" && ev.token) out += ev.token;
    }
    return out;
  }

  private notify(title: string, body: string): void {
    try {
      Bun.spawn(["notify-send", "-a", "socius", title, body], {
        stdout: "ignore",
        stderr: "ignore",
      });
    } catch {
      this.log.debug("notify-send unavailable");
    }
  }

  /** Watch config.toml (hot-reload safe sections) and the knowledge base (auto-reindex). */
  private setupWatchers(): void {
    const paths = resolvePaths();
    const configDir = dirname(paths.configFile);
    if (existsSync(configDir)) {
      try {
        this.watchers.push(
          watch(configDir, (_e, file) => {
            if (file && basename(paths.configFile) === file)
              this.debounce("config", 400, () => this.reloadConfig());
          }),
        );
      } catch {
        /* watching is best-effort */
      }
    }
    const kb = this.config.storage.knowledgeDir;
    if (this.memory && existsSync(kb)) {
      try {
        this.watchers.push(
          watch(kb, { recursive: true }, (_e, file) => {
            if (file && String(file).endsWith(".md"))
              this.debounce("kb", 1000, () => this.reindexKnowledge());
          }),
        );
      } catch {
        /* recursive watch may be unsupported; reindex via `socius knowledge index` still works */
      }
    }
  }

  private debounce(key: string, ms: number, fn: () => void): void {
    const existing = this.debounces.get(key);
    if (existing) clearTimeout(existing);
    this.debounces.set(
      key,
      setTimeout(() => {
        this.debounces.delete(key);
        fn();
      }, ms),
    );
  }

  /** Reload config.toml and apply the sections that are safe to change live. */
  private reloadConfig(): void {
    let next: SociusConfig;
    try {
      next = loadConfig(resolvePaths());
    } catch (err) {
      this.log.warn("config reload failed, keeping current", {
        err: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const restartNeeded =
      next.model.path !== this.config.model.path ||
      next.model.id !== this.config.model.id ||
      next.inference.port !== this.config.inference.port ||
      JSON.stringify(next.mcp) !== JSON.stringify(this.config.mcp);

    // Live-applicable: permission policy + overrides, execution mode, memory budgets.
    this.config = next;
    this.policy = new ConfiguredPolicyEngine(next.permissions.policy, {
      ...(next.permissions.tools ? { tools: next.permissions.tools } : {}),
      ...(next.permissions.paths ? { paths: [...next.permissions.paths] } : {}),
    });
    this.log.info("config reloaded", { restartNeeded });
    if (restartNeeded) {
      this.log.warn("model/inference/mcp changes need a restart to apply — run `socius restart`");
    }
  }

  private async reindexKnowledge(): Promise<void> {
    if (!this.memory) return;
    const r = await indexKnowledge(this.config.storage.knowledgeDir, this.memory);
    if (r.ok)
      this.log.info("knowledge auto-reindexed", { files: r.value.files, chunks: r.value.chunks });
  }

  private serve(socketPath: string): void {
    this.server = Bun.listen({
      unix: socketPath,
      socket: {
        open: (socket: Sock) => {
          this.conns.set(socket, { buffer: new LineBuffer(), current: null, confirmer: null });
        },
        data: (socket: Sock, data: Uint8Array) => {
          const state = this.conns.get(socket);
          if (!state) return;
          for (const msg of state.buffer.push(new TextDecoder().decode(data))) {
            void this.dispatch(socket, state, msg);
          }
        },
        close: (socket: Sock) => {
          const s = this.conns.get(socket);
          s?.current?.abort();
          s?.confirmer?.denyAll();
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
        case "confirm.response": {
          const p = msg.params as { id: string; approved: boolean };
          state.confirmer?.resolve(p.id, p.approved === true);
          break; // no response — this is a client-initiated notification
        }
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
        case "mem.search": {
          const p = msg.params as { text: string; k?: number };
          socket.write(response(id, await this.memSearch(p.text, p.k)));
          break;
        }
        case "mem.show":
          socket.write(response(id, await this.memShow((msg.params as { id: string }).id)));
          break;
        case "mem.edit": {
          const p = msg.params as { id: string; content: string };
          socket.write(response(id, await this.memEdit(p.id, p.content)));
          break;
        }
        case "knowledge.index":
          socket.write(response(id, await this.knowledgeIndex()));
          break;
        case "knowledge.search":
          socket.write(
            response(id, await this.knowledgeSearch((msg.params as { text: string }).text)),
          );
          break;
        case "schedule.list":
          socket.write(
            response(id, {
              schedules: this.config.schedules.map((s) => ({
                name: s.name,
                enabled: s.enabled,
                ...(s.everyMinutes ? { everyMinutes: s.everyMinutes } : {}),
                ...(s.dailyAt ? { dailyAt: s.dailyAt } : {}),
              })),
            }),
          );
          break;
        case "schedule.run":
          socket.write(
            response(id, { answer: await this.runSchedule((msg.params as { name: string }).name) }),
          );
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
    if (!this.registry || !this.policy) {
      socket.write(errorResponse(id, -32000, "daemon not ready"));
      return;
    }
    const controller = new AbortController();
    state.current = controller;

    // Per-request runner + planner carrying a confirmer bound to THIS socket, so
    // a destructive tool prompts this exact client and blocks until it answers.
    const confirmer = new IpcConfirmer(socket);
    state.confirmer = confirmer;
    const runner = new ToolRunner(this.policy, confirmer);
    const planner = new GraphPlanner({
      backend: this.runtime.backend(),
      systemPrompt: this.systemPrompt,
      tools: this.registry,
      runner,
      mode: params.mode ?? this.config.permissions.defaultMode,
      traceSink: this.traceSink,
      ...(this.memory
        ? { memory: this.memory, memoryTokenBudget: this.config.memory.defaultTokenBudget }
        : {}),
    });

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
      for await (const ev of planner.run(ctx)) {
        if (ev.type === "token" && ev.token)
          socket.write(notify({ kind: "token", text: ev.token }));
        else if (ev.type === "step" && ev.step)
          socket.write(notify({ kind: "step", label: ev.step.label }));
      }
      socket.write(notify({ kind: "done" }));
      socket.write(response(id, { ok: true }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      socket.write(errorResponse(id, -32000, message));
    } finally {
      confirmer.denyAll();
      state.confirmer = null;
      state.current = null;
    }
  }

  private async health(): Promise<{
    modelReady: boolean;
    modelId: string;
    memory: boolean;
    tools: number;
    mcp: { name: string; connected: boolean; toolCount: number; error?: string }[];
  }> {
    const h = await this.runtime.backend().health();
    return {
      modelReady: h.healthy,
      modelId: this.config.model.id,
      memory: this.memory !== null,
      tools: this.registry?.all().length ?? 0,
      mcp: this.mcp?.status().map((s) => ({ ...s })) ?? [],
    };
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

  private async memForget(idOrPrefix: string): Promise<{ ok: boolean }> {
    const id = await this.resolveMemoryId(idOrPrefix);
    if (!this.memory) throw new Error("memory is not available");
    const r = await this.memory.forget(id);
    if (!r.ok) throw r.error;
    return { ok: true };
  }

  private async memShow(idOrPrefix: string): Promise<{ memory: unknown }> {
    const id = await this.resolveMemoryId(idOrPrefix);
    if (!this.memory) throw new Error("memory is not available");
    const r = await this.memory.get(id);
    if (!r.ok) throw r.error;
    if (!r.value) throw new Error(`no memory ${idOrPrefix}`);
    const m = r.value;
    return {
      memory: {
        id: m.id,
        kind: m.kind,
        content: m.content,
        confidence: m.confidence,
        tags: m.tags,
        source: m.source,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      },
    };
  }

  private async memEdit(idOrPrefix: string, content: string): Promise<{ id: string }> {
    const id = await this.resolveMemoryId(idOrPrefix);
    if (!this.memory) throw new Error("memory is not available");
    const r = await this.memory.update(id, { content });
    if (!r.ok) throw r.error;
    return { id: r.value.id };
  }

  private async memSearch(
    text: string,
    k?: number,
  ): Promise<{ results: { content: string; kind: string; score: number }[] }> {
    if (!this.memory) throw new Error("memory is not available");
    const r = await this.memory.retrieve({ text, ...(k ? { k } : {}) });
    if (!r.ok) throw r.error;
    return {
      results: r.value.map((m) => ({
        content: m.memory.content,
        kind: m.memory.kind,
        score: m.score,
      })),
    };
  }

  /** Resolve a full id or a unique id-prefix (as shown by `mem list`). */
  private async resolveMemoryId(idOrPrefix: string): Promise<import("@socius/core").MemoryId> {
    if (!this.memory) throw new Error("memory is not available");
    const r = await this.memory.list({ limit: 100_000 });
    if (!r.ok) throw r.error;
    const matches = r.value.filter((m) => m.id === idOrPrefix || m.id.startsWith(idOrPrefix));
    if (matches.length === 0) throw new Error(`no memory matching '${idOrPrefix}'`);
    const only = matches[0];
    if (!only || matches.length > 1)
      throw new Error(`'${idOrPrefix}' is ambiguous or missing (${matches.length} matches)`);
    return only.id;
  }

  private async knowledgeIndex(): Promise<{ files: number; chunks: number }> {
    if (!this.memory) throw new Error("memory is not available");
    const r = await indexKnowledge(this.config.storage.knowledgeDir, this.memory);
    if (!r.ok) throw r.error;
    return r.value;
  }

  private async knowledgeSearch(
    text: string,
  ): Promise<{ results: { content: string; ref?: string }[] }> {
    if (!this.memory) throw new Error("memory is not available");
    const r = await this.memory.retrieve({ text, kinds: ["knowledge"] });
    if (!r.ok) throw r.error;
    return {
      results: r.value.map((m) => ({
        content: m.memory.content,
        ...(m.memory.source.ref ? { ref: m.memory.source.ref } : {}),
      })),
    };
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
    for (const w of this.watchers) w.close();
    for (const t of this.debounces.values()) clearTimeout(t);
    for (const t of this.scheduleTimers) clearInterval(t);
    this.server?.stop();
    await this.mcp?.close();
    await this.runtime.stop();
    this.database?.close();
    await rm(this.config.daemon.socketPath, { force: true }).catch(() => {});
    await rm(this.config.daemon.pidPath, { force: true }).catch(() => {});
    this.log.info("sociusd stopped");
  }
}
