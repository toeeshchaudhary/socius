#!/usr/bin/env bun
/**
 * `socius` entrypoint — the thin client. Parses args + stdin, finds or spawns the
 * daemon, and streams the answer to stdout. Diagnostics go to stderr so piped
 * stdout stays clean.
 */
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { flatten, loadConfig, resolvePaths, setOverride, unsetOverride } from "@socius/config";
import { IPC_PROTOCOL_VERSION } from "@socius/core";
import { GATEWAYS, checkApiKey } from "@socius/inference";
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
  w(
    `  protocol v${IPC_PROTOCOL_VERSION} · gpuLayers ${config.model.gpuLayers} · ctx ${config.model.contextWindow}`,
  );
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
      process.stdout.write(
        `id      ${m.id}\nkind    ${m.kind}\nconf    ${m.confidence}\ntags    ${(m.tags ?? []).join(", ")}\n\n${m.content}\n`,
      );
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
        process.stdout.write(
          `• ${r.ref ?? "?"}\n  ${r.content.replace(/\n/g, " ").slice(0, 120)}\n`,
        );
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
    const clip = (s: string, k: number) =>
      (s.length > k ? `${s.slice(0, k)}…` : s).replace(/\n/g, " ");
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
      const when = s.everyMinutes
        ? `every ${s.everyMinutes}m`
        : s.dailyAt
          ? `daily at ${s.dailyAt}`
          : "manual";
      process.stdout.write(`${s.enabled ? "●" : "○"} ${s.name.padEnd(16)} ${when}\n`);
    }
    return 0;
  } finally {
    client.close();
  }
}

/** Redact values whose key smells like a secret in `config list` output. */
function redact(key: string, value: unknown): string {
  const secret = /key|token|secret|password/i.test(key);
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return secret && s ? "••••••" : s;
}

/** Parse a CLI value: JSON if it parses (numbers, bools, arrays), else string. */
function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function configCmd(args: readonly string[]): Promise<number> {
  const paths = resolvePaths();
  const sub = args[0] ?? "list";

  if (sub === "list") {
    const config = loadConfig(paths);
    for (const [k, v] of flatten(config)) {
      process.stdout.write(`${k} = ${redact(k, v)}\n`);
    }
    return 0;
  }
  if (sub === "get") {
    if (!args[1]) {
      process.stderr.write("usage: socius config get <key>\n");
      return 2;
    }
    const entries = flatten(loadConfig(paths)).filter(
      ([k]) => k === args[1] || k.startsWith(`${args[1]}.`),
    );
    if (entries.length === 0) {
      process.stderr.write(`socius: no such key '${args[1]}'\n`);
      return 1;
    }
    for (const [k, v] of entries) {
      process.stdout.write(entries.length === 1 ? `${v}\n` : `${k} = ${redact(k, v)}\n`);
    }
    return 0;
  }
  if (sub === "set") {
    const [, key, ...rest] = args;
    if (!key || rest.length === 0) {
      process.stderr.write("usage: socius config set <key> <value>\n");
      return 2;
    }
    setOverride(key, parseValue(rest.join(" ")), paths);
    loadConfig(paths); // fail fast if the result no longer parses/merges
    process.stdout.write(`${key} set. Run 'socius restart' to apply.\n`);
    return 0;
  }
  if (sub === "unset") {
    if (!args[1]) {
      process.stderr.write("usage: socius config unset <key>\n");
      return 2;
    }
    const removed = unsetOverride(args[1], paths);
    process.stdout.write(
      removed
        ? `${args[1]} unset (falls back to config.toml/default). Run 'socius restart' to apply.\n`
        : `${args[1]} was not set via CLI (config.toml values must be edited there).\n`,
    );
    return removed ? 0 : 1;
  }
  process.stderr.write(
    "usage: socius config [list | get <key> | set <key> <value> | unset <key>]\n",
  );
  return 2;
}

async function key(args: readonly string[]): Promise<number> {
  const paths = resolvePaths();
  const sub = args[0] ?? "list";

  if (sub === "set") {
    const force = args.includes("--force");
    const [, gateway, value] = args.filter((a) => a !== "--force");
    if (!gateway || !value) {
      process.stderr.write("usage: socius key set <gateway> <key> [--force]\n");
      process.stderr.write(`gateways: ${Object.keys(GATEWAYS).join(", ")}, or any custom name\n`);
      return 2;
    }
    if (!GATEWAYS[gateway] && gateway !== "custom") {
      process.stderr.write(
        `socius: note — '${gateway}' is not a built-in gateway (${Object.keys(GATEWAYS).join(", ")}); storing anyway.\n`,
      );
    }
    // Live-check the key against the gateway before saving, so a typo'd key
    // fails here instead of as a 401 on the first query.
    const preset = GATEWAYS[gateway];
    const baseUrl = preset?.baseUrl ?? loadConfig(paths).inference.remote?.baseUrl;
    if (baseUrl) {
      process.stderr.write(`socius: checking key against ${baseUrl}…\n`);
      const check = await checkApiKey(baseUrl, value, preset?.keyCheckPath);
      if (check.status === "invalid" && !force) {
        process.stderr.write(
          `socius: gateway rejected this key (${check.detail}) — not saved. Use --force to save anyway.\n`,
        );
        return 1;
      }
      if (check.status === "invalid") {
        process.stderr.write(
          `socius: gateway rejected this key (${check.detail}) — saving because of --force.\n`,
        );
      } else if (check.status === "unreachable") {
        process.stderr.write(
          `socius: could not verify key (${check.detail}) — saving unverified.\n`,
        );
      } else {
        process.stdout.write("key is valid.\n");
      }
    } else {
      process.stderr.write(
        "socius: no baseUrl known for this gateway — saving unverified (set inference.remote.baseUrl for custom gateways).\n",
      );
    }
    setOverride(`keys.${gateway}`, value, paths);
    process.stdout.write(`key for '${gateway}' saved (${paths.cliConfigFile}, mode 600).\n`);
    const config = loadConfig(paths);
    if (config.inference.backend === "remote" && config.inference.remote?.gateway === gateway) {
      return restart();
    }
    return 0;
  }
  if (sub === "remove") {
    if (!args[1]) {
      process.stderr.write("usage: socius key remove <gateway>\n");
      return 2;
    }
    const removed = unsetOverride(`keys.${args[1]}`, paths);
    process.stdout.write(removed ? "removed.\n" : `no stored key for '${args[1]}'.\n`);
    return removed ? 0 : 1;
  }
  if (sub === "list") {
    const config = loadConfig(paths);
    const stored = Object.keys(config.keys);
    for (const [name, g] of Object.entries(GATEWAYS)) {
      const state = stored.includes(name)
        ? "stored"
        : process.env[g.keyEnv]
          ? `from env ${g.keyEnv}`
          : "not set";
      process.stdout.write(`  ${name.padEnd(11)} ${state}\n`);
    }
    for (const name of stored.filter((n) => !GATEWAYS[n])) {
      process.stdout.write(`  ${name.padEnd(11)} stored\n`);
    }
    return 0;
  }
  process.stderr.write("usage: socius key [list | set <gateway> <key> | remove <gateway>]\n");
  return 2;
}

async function model(args: readonly string[]): Promise<number> {
  const paths = resolvePaths();
  const sub = args[0];

  if (!sub || sub === "show") {
    const config = loadConfig(paths);
    if (config.inference.backend === "remote" && config.inference.remote) {
      const r = config.inference.remote;
      process.stdout.write(`remote  ${r.gateway}  ${r.model}\n`);
    } else {
      process.stdout.write(`local   ${config.model.id}\n`);
    }
    return 0;
  }
  if (sub === "list") {
    process.stdout.write("gateways (socius model use <gateway> <model>):\n");
    for (const [name, g] of Object.entries(GATEWAYS)) {
      process.stdout.write(`  ${name.padEnd(11)} ${g.note}\n      key: \${${g.keyEnv}}\n`);
    }
    process.stdout.write(
      "  custom      any OpenAI-compatible baseUrl (set inference.remote.baseUrl)\n",
    );
    process.stdout.write("  local       switch back with 'socius model local'\n");
    return 0;
  }
  if (sub === "local") {
    setOverride("inference.backend", "local", paths);
    return restart();
  }
  if (sub === "use") {
    const [, gateway, modelId, apiKey] = args;
    if (!gateway || !modelId) {
      process.stderr.write("usage: socius model use <gateway> <model> [apiKey]\n");
      return 2;
    }
    const preset = GATEWAYS[gateway];
    if (!preset && gateway !== "custom") {
      process.stderr.write(
        `socius: unknown gateway '${gateway}' (known: ${Object.keys(GATEWAYS).join(", ")}, custom)\n`,
      );
      return 1;
    }
    setOverride("inference.backend", "remote", paths);
    setOverride("inference.remote.gateway", gateway, paths);
    setOverride("inference.remote.model", modelId, paths);
    // An explicit key argument is saved to the per-gateway key store so it is
    // reused next time. Otherwise the daemon resolves: inference.remote.apiKey
    // (config.toml) → stored key (socius key set) → the gateway's env var.
    if (apiKey) setOverride(`keys.${gateway}`, apiKey, paths);
    const config = loadConfig(paths);
    const resolvable =
      config.inference.remote?.apiKey ||
      config.keys[gateway] ||
      (preset && process.env[preset.keyEnv]);
    if (!resolvable) {
      const envHint = preset ? ` or export ${preset.keyEnv}` : "";
      process.stderr.write(
        `socius: no API key for '${gateway}' yet — run 'socius key set ${gateway} <key>'${envHint}.\n`,
      );
    }
    process.stdout.write(
      `now using ${config.inference.remote?.gateway}/${config.inference.remote?.model}\n`,
    );
    return restart();
  }
  process.stderr.write(
    "usage: socius model [show | list | use <gateway> <model> [apiKey] | local]\n",
  );
  return 2;
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

  if (command === "serve") {
    // MCP server mode — stdin/stdout are the MCP transport, so route before readStdin.
    const { runMcpServer } = await import("./mcp-server.ts");
    await runMcpServer();
    return 0;
  }
  if (command === "doctor") return doctor();
  if (command === "restart") return restart();
  if (command === "config") return configCmd(args.slice(1));
  if (command === "model") return model(args.slice(1));
  if (command === "key") return key(args.slice(1));
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
    process.stderr.write("commands:\n");
    process.stderr.write("  remember <text>            save a memory\n");
    process.stderr.write("  mem [list|show|edit|forget]  inspect/edit memory\n");
    process.stderr.write("  knowledge [index|search]   Markdown knowledge base\n");
    process.stderr.write(
      "  morning                    a briefing (git + email/calendar if available)\n",
    );
    process.stderr.write("  schedule [list|run <name>] background tasks\n");
    process.stderr.write("  trace [n] [--full]         replay recent model reasoning\n");
    process.stderr.write(
      "  serve                      run Socius as an MCP server (for other clients)\n",
    );
    process.stderr.write(
      "  config [get|set|unset|list]  configure from the CLI (no TOML editing)\n",
    );
    process.stderr.write("  model [use|local|list]     switch between local and gateway models\n");
    process.stderr.write("  key [set|remove|list]      store gateway API keys\n");
    process.stderr.write("  doctor | restart           status / restart the daemon\n");
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
