#!/usr/bin/env bun
/**
 * `socius` entrypoint — the thin client. Parses args + stdin, finds or spawns the
 * daemon, and streams the answer to stdout. Diagnostics go to stderr so piped
 * stdout stays clean.
 */
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { IPC_PROTOCOL_VERSION } from "@socius/core";
import { loadConfig, resolvePaths } from "@socius/config";
import { DaemonClient, ensureDaemon } from "./client.ts";
import { readStdin } from "./index.ts";

/**
 * Ask the user to approve a tool. Reads from /dev/tty (not stdin, which may be a
 * pipe). If no terminal is available, deny — Socius never auto-runs a destructive
 * tool in a non-interactive context.
 */
async function promptConfirm(prompt: string): Promise<boolean> {
  if (!existsSync("/dev/tty")) {
    process.stderr.write(`socius: ${prompt}\nsocius: no terminal to confirm — denying.\n`);
    return false;
  }
  return new Promise((resolve) => {
    const input = createReadStream("/dev/tty");
    const rl = createInterface({ input, output: process.stderr });
    rl.question(`\nSocius wants to run: ${prompt}\n  [y] run   [N] skip  > `, (answer) => {
      rl.close();
      input.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function doctor(): Promise<number> {
  const paths = resolvePaths();
  const config = loadConfig(paths);
  const w = (s: string) => process.stdout.write(`${s}\n`);
  const mark = (ok: boolean) => (ok ? "ok  " : "FAIL");

  const modelOk = existsSync(config.model.path);
  const binOk = existsSync(config.inference.llamaServerBin);
  const client = await DaemonClient.connect(config.daemon.socketPath);
  let daemonLine = "not running (will spawn on first use)";
  let extra = "";
  if (client) {
    try {
      const hs = await client.handshake();
      daemonLine = `running — protocol ${hs.protocolVersion}, model ${hs.modelId}, ready=${hs.modelReady}`;
      const health = await client.health();
      extra = `  [    ] tools         ${health.tools ?? "?"} registered · memory ${health.memory ? "on" : "off"}\n`;
      for (const s of health.mcp ?? []) {
        extra += `  [${mark(s.connected)}] mcp:${s.name.padEnd(8)} ${s.connected ? `${s.toolCount} tools` : `down — ${s.error ?? ""}`}\n`;
      }
    } catch (e) {
      daemonLine = `reachable but handshake failed: ${e instanceof Error ? e.message : e}`;
    }
    client.close();
  }

  w("socius doctor");
  w(`  [${mark(true)}] config dir    ${paths.configDir}`);
  w(`  [${mark(true)}] data dir      ${paths.dataDir}`);
  w(`  [${mark(modelOk)}] model file    ${config.model.path}`);
  w(`  [${mark(binOk)}] llama-server  ${config.inference.llamaServerBin}`);
  w(`  [${mark(true)}] socket        ${config.daemon.socketPath}`);
  w(`  [    ] daemon        ${daemonLine}`);
  if (extra) process.stdout.write(extra);
  w(`  protocol v${IPC_PROTOCOL_VERSION} · gpuLayers ${config.model.gpuLayers} · ctx ${config.model.contextWindow}`);
  if (!modelOk) w("  ! model file missing — set model.path in config.toml");
  if (!binOk) w("  ! llama-server not found — set inference.llamaServerBin");
  return modelOk && binOk ? 0 : 1;
}

async function remember(text: string): Promise<number> {
  if (!text) {
    process.stderr.write("usage: socius remember <text>\n");
    return 2;
  }
  const config = loadConfig(resolvePaths());
  const client = await ensureDaemon(config);
  const { id } = await client.remember(text);
  client.close();
  process.stdout.write(`remembered (${id.slice(0, 8)})\n`);
  return 0;
}

async function mem(args: readonly string[]): Promise<number> {
  const sub = args[0];
  const config = loadConfig(resolvePaths());
  const client = await ensureDaemon(config);
  try {
    if (sub === "forget") {
      const id = args[1];
      if (!id) {
        process.stderr.write("usage: socius mem forget <id>\n");
        return 2;
      }
      await client.memForget(id);
      process.stdout.write("forgotten\n");
      return 0;
    }
    if (sub === "show") {
      const id = args[1];
      if (!id) {
        process.stderr.write("usage: socius mem show <id>\n");
        return 2;
      }
      const { memory: m } = await client.memShow(id);
      process.stdout.write(`id      ${m.id}\nkind    ${m.kind}\nconf    ${m.confidence}\ntags    ${(m.tags ?? []).join(", ")}\n\n${m.content}\n`);
      return 0;
    }
    if (sub === "edit") {
      const id = args[1];
      const content = args.slice(2).join(" ").trim();
      if (!id || !content) {
        process.stderr.write("usage: socius mem edit <id> <new content>\n");
        return 2;
      }
      await client.memEdit(id, content);
      process.stdout.write("updated\n");
      return 0;
    }
    // default: list
    const { memories } = await client.memList(undefined, 50);
    if (memories.length === 0) {
      process.stdout.write("(no memories yet — use `socius remember <text>`)\n");
      return 0;
    }
    for (const m of memories) {
      const when = new Date(m.updatedAt).toISOString().slice(0, 10);
      process.stdout.write(
        `${m.id.slice(0, 8)}  ${m.kind.padEnd(14)}  ${when}  ${m.content.replace(/\n/g, " ").slice(0, 80)}\n`,
      );
    }
    return 0;
  } finally {
    client.close();
  }
}

async function knowledge(args: readonly string[]): Promise<number> {
  const sub = args[0];
  const config = loadConfig(resolvePaths());
  const client = await ensureDaemon(config);
  try {
    if (sub === "index") {
      const { files, chunks } = await client.knowledgeIndex();
      process.stdout.write(`indexed ${files} file(s) into ${chunks} chunk(s)\n`);
      return 0;
    }
    if (sub === "search") {
      const q = args.slice(1).join(" ").trim();
      if (!q) {
        process.stderr.write("usage: socius knowledge search <query>\n");
        return 2;
      }
      const { results } = await client.knowledgeSearch(q);
      if (results.length === 0) {
        process.stdout.write("(no matches — run `socius knowledge index` first)\n");
        return 0;
      }
      for (const r of results) {
        process.stdout.write(`• ${r.ref ?? "?"}\n  ${r.content.replace(/\n/g, " ").slice(0, 120)}\n`);
      }
      return 0;
    }
    process.stderr.write("usage: socius knowledge [index | search <query>]\n");
    return 2;
  } finally {
    client.close();
  }
}

async function trace(args: readonly string[]): Promise<number> {
  const { readFileSync, existsSync: exists } = await import("node:fs");
  const { join } = await import("node:path");
  const config = loadConfig(resolvePaths());
  const file = join(config.logging.dir, "traces.jsonl");
  if (!exists(file)) {
    process.stdout.write("(no traces yet — ask something first; tracing is on by default)\n");
    return 0;
  }
  const n = Number(args[0]) || 10;
  const full = args.includes("--full");
  const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).slice(-n);
  for (const line of lines) {
    let t: { slot: string; valid: boolean; latencyMs: number; prompt: string; rawOutput: string };
    try {
      t = JSON.parse(line);
    } catch {
      continue;
    }
    const clip = (s: string, k: number) => (s.length > k ? `${s.slice(0, k)}…` : s).replace(/\n/g, " ");
    process.stdout.write(`\n● ${t.slot}  (${t.latencyMs}ms, ${t.valid ? "valid" : "INVALID"})\n`);
    process.stdout.write(`  prompt: ${clip(t.prompt, full ? 100000 : 200)}\n`);
    process.stdout.write(`  output: ${clip(t.rawOutput, full ? 100000 : 200)}\n`);
  }
  return 0;
}

const MORNING_PROMPT =
  "Give me a concise morning briefing as short scannable bullet points. " +
  "If you have email or calendar tools available, summarize today's important emails and upcoming events. " +
  "If the current directory is a git repository, summarize recent activity and uncommitted changes. " +
  "Keep it brief — skip anything you have no data for.";

async function morning(): Promise<number> {
  return ask(MORNING_PROMPT, undefined);
}

async function schedule(args: readonly string[]): Promise<number> {
  const sub = args[0];
  const config = loadConfig(resolvePaths());
  const client = await ensureDaemon(config);
  try {
    if (sub === "run") {
      const name = args[1];
      if (!name) {
        process.stderr.write("usage: socius schedule run <name>\n");
        return 2;
      }
      const { answer } = await client.scheduleRun(name);
      process.stdout.write(`${answer}\n`);
      return 0;
    }
    const { schedules } = await client.scheduleList();
    if (schedules.length === 0) {
      process.stdout.write("(no schedules — add [[schedules]] entries to config.toml)\n");
      return 0;
    }
    for (const s of schedules) {
      const when = s.everyMinutes ? `every ${s.everyMinutes}m` : s.dailyAt ? `daily at ${s.dailyAt}` : "manual";
      process.stdout.write(`${s.enabled ? "●" : "○"} ${s.name.padEnd(16)} ${when}\n`);
    }
    return 0;
  } finally {
    client.close();
  }
}

async function restart(): Promise<number> {
  const config = loadConfig(resolvePaths());
  const client = await DaemonClient.connect(config.daemon.socketPath);
  if (client) {
    await client.shutdown().catch(() => {});
    client.close();
    process.stderr.write("socius: daemon shut down. It will respawn on next use.\n");
  } else {
    process.stderr.write("socius: no daemon running.\n");
  }
  return 0;
}

async function ask(input: string, stdin: string | undefined): Promise<number> {
  const config = loadConfig(resolvePaths());
  const warming = !existsSync(config.daemon.socketPath);
  if (warming && process.stderr.isTTY) process.stderr.write("socius: warming model…\n");

  const client = await ensureDaemon(config);
  const hs = await client.handshake();
  if (hs.protocolVersion !== IPC_PROTOCOL_VERSION) {
    process.stderr.write(
      `socius: protocol mismatch (cli v${IPC_PROTOCOL_VERSION}, daemon v${hs.protocolVersion}). Run 'socius restart'.\n`,
    );
    client.close();
    return 1;
  }

  await client.infer(
    { input, ...(stdin ? { stdin } : {}) },
    (text) => process.stdout.write(text),
    promptConfirm,
  );
  if (process.stdout.isTTY) process.stdout.write("\n");
  client.close();
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = argv.slice(2);
  const command = args[0];

  if (command === "doctor") return doctor();
  if (command === "restart") return restart();
  if (command === "remember") return remember(args.slice(1).join(" ").trim());
  if (command === "mem") return mem(args.slice(1));
  if (command === "knowledge") return knowledge(args.slice(1));
  if (command === "trace") return trace(args.slice(1));
  if (command === "morning") return morning();
  if (command === "schedule") return schedule(args.slice(1));

  const input = args.join(" ").trim();
  const stdin = await readStdin();
  if (!input && !stdin) {
    process.stderr.write("usage: socius <question>   |   <cmd> | socius <question>\n");
    process.stderr.write(
      "       socius remember <text> | mem [list|forget <id>] | knowledge [index|search] | trace [n] | doctor | restart\n",
    );
    return 2;
  }
  return ask(input || "Summarize and explain the following.", stdin);
}

main(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`socius: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
