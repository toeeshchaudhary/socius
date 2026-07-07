import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BackendHealth,
  CompletionChunk,
  CompletionRequest,
  InferenceBackend,
  Result,
  SociusConfig,
} from "@socius/core";
import { ok } from "@socius/core";
import { defaultConfig } from "@socius/config";
import { ConsoleLogger } from "@socius/logging";
import { Daemon } from "./daemon.ts";
import type { ModelRuntime } from "./runtime.ts";

/** A fake model runtime: no child process, scripted tokens. */
class FakeRuntime implements ModelRuntime {
  constructor(private readonly tokens: readonly string[]) {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  backend(): InferenceBackend {
    const tokens = this.tokens;
    return {
      id: "fake",
      async *complete(_req: CompletionRequest): AsyncIterable<CompletionChunk> {
        for (const t of tokens) yield { type: "token", text: t };
        yield { type: "done", text: "" };
      },
      async countTokens(): Promise<Result<number>> {
        return ok(0);
      },
      contextWindow: () => 4096,
      async health(): Promise<BackendHealth> {
        return { healthy: true, modelId: "fake", contextWindow: 4096 };
      },
    };
  }
}

/**
 * A minimal in-test JSON-RPC client over the Unix socket. Kept independent of
 * @socius/cli so the daemon test does not depend upward on the CLI package.
 */
interface RpcOpts {
  onNotify?: (n: { kind: string; text?: string }) => void;
  onConfirm?: (prompt: string) => boolean;
}

async function rpc(socketPath: string, method: string, params: unknown, opts: RpcOpts = {}): Promise<unknown> {
  let resolveDone!: (v: unknown) => void;
  let rejectDone!: (e: Error) => void;
  const done = new Promise<unknown>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });
  let buf = "";
  const socket = await Bun.connect({
    unix: socketPath,
    socket: {
      data(_s, data: Uint8Array) {
        buf += new TextDecoder().decode(data);
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.method === "notify") {
            const n = msg.params;
            if (n.kind === "confirm") {
              const approved = opts.onConfirm ? opts.onConfirm(n.prompt) : false;
              socket.write(
                `${JSON.stringify({ jsonrpc: "2.0", method: "confirm.response", params: { id: n.id, approved } })}\n`,
              );
            } else {
              opts.onNotify?.(n);
            }
          } else if (msg.error) rejectDone(new Error(msg.error.message));
          else resolveDone(msg.result);
        }
      },
    },
  });
  socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}\n`);
  const result = await done;
  socket.end();
  return result;
}

describe("Daemon IPC (hermetic, fake model)", () => {
  let dir: string;
  let daemon: Daemon;
  let config: SociusConfig;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "socius-daemon-"));
    const base = defaultConfig();
    config = {
      ...base,
      daemon: { ...base.daemon, socketPath: join(dir, "sock"), pidPath: join(dir, "pid") },
      logging: { ...base.logging, dir, level: "error" },
      promptsDir: join(dir, "prompts"),
    };
    const log = new ConsoleLogger({ level: "error", subsystem: "daemon" });
    daemon = new Daemon(config, log, new FakeRuntime(["Soc", "ius", " online"]));
    await daemon.start();
  });

  afterEach(async () => {
    await daemon.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("handshake reports protocol + model readiness", async () => {
    const hs = (await rpc(config.daemon.socketPath, "handshake", {
      protocolVersion: 0,
      clientVersion: "test",
    })) as { protocolVersion: number; modelReady: boolean };
    expect(hs.protocolVersion).toBe(0);
    expect(hs.modelReady).toBe(true);
  });

  test("infer streams tokens from the backend to the client", async () => {
    let out = "";
    await rpc(config.daemon.socketPath, "infer", { input: "who are you?" }, {
      onNotify: (n) => {
        if (n.kind === "token" && n.text) out += n.text;
      },
    });
    expect(out).toBe("Socius online");
  });

  test("unknown method returns a JSON-RPC error", async () => {
    await expect(rpc(config.daemon.socketPath, "bogus", {})).rejects.toThrow(/unknown method/);
  });
});

/** Runtime that scripts the model to pick fs.write (destructive) then answer. */
class WriteThenAnswerRuntime implements ModelRuntime {
  constructor(private readonly path: string) {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  backend(): InferenceBackend {
    const path = this.path;
    let decideCall = 0;
    return {
      id: "fake",
      async *complete(req: CompletionRequest): AsyncIterable<CompletionChunk> {
        if (req.responseSchema) {
          const json =
            decideCall++ === 0
              ? JSON.stringify({ action: "tool", tool: "fs.write", args: { path, content: "hi" }, reason: "save" })
              : JSON.stringify({ action: "answer" });
          yield { type: "token", text: json };
          yield { type: "done", text: "" };
          return;
        }
        yield { type: "token", text: "done" };
        yield { type: "done", text: "" };
      },
      async countTokens(): Promise<Result<number>> {
        return ok(0);
      },
      contextWindow: () => 4096,
      async health(): Promise<BackendHealth> {
        return { healthy: true, modelId: "fake", contextWindow: 4096 };
      },
    };
  }
}

describe("Daemon interactive confirmation (destructive tool)", () => {
  let dir: string;
  let daemon: Daemon;
  let config: SociusConfig;
  let targetFile: string;

  async function boot() {
    dir = await mkdtemp(join(tmpdir(), "socius-confirm-"));
    targetFile = join(dir, "written.txt");
    const base = defaultConfig();
    config = {
      ...base,
      daemon: { ...base.daemon, socketPath: join(dir, "sock"), pidPath: join(dir, "pid") },
      logging: { ...base.logging, dir, level: "error" },
      promptsDir: join(dir, "prompts"),
    };
    const log = new ConsoleLogger({ level: "error", subsystem: "daemon" });
    daemon = new Daemon(config, log, new WriteThenAnswerRuntime(targetFile));
    await daemon.start();
  }

  test("writes the file only when the user approves", async () => {
    await boot();
    await rpc(config.daemon.socketPath, "infer", { input: "save hi to a file" }, { onConfirm: () => true });
    expect(await Bun.file(targetFile).exists()).toBe(true);
    await daemon.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("does NOT write the file when the user declines", async () => {
    await boot();
    await rpc(config.daemon.socketPath, "infer", { input: "save hi to a file" }, { onConfirm: () => false });
    expect(await Bun.file(targetFile).exists()).toBe(false);
    await daemon.stop();
    await rm(dir, { recursive: true, force: true });
  });
});
