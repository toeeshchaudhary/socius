#!/usr/bin/env bun
/**
 * `socius` entrypoint — the thin client. Parses args + stdin, finds or spawns the
 * daemon, and streams the answer to stdout. Diagnostics go to stderr so piped
 * stdout stays clean.
 */
import { existsSync } from "node:fs";
import { IPC_PROTOCOL_VERSION } from "@socius/core";
import { defaultConfig, resolvePaths } from "@socius/config";
import { DaemonClient, ensureDaemon } from "./client.ts";
import { readStdin } from "./index.ts";

async function doctor(): Promise<number> {
  const paths = resolvePaths();
  const config = defaultConfig(paths);
  const w = (s: string) => process.stdout.write(`${s}\n`);
  const mark = (ok: boolean) => (ok ? "ok  " : "FAIL");

  const modelOk = existsSync(config.model.path);
  const binOk = existsSync(config.inference.llamaServerBin);
  const client = await DaemonClient.connect(config.daemon.socketPath);
  let daemonLine = "not running (will spawn on first use)";
  if (client) {
    try {
      const hs = await client.handshake();
      daemonLine = `running — protocol ${hs.protocolVersion}, model ${hs.modelId}, ready=${hs.modelReady}`;
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
  w(`  protocol v${IPC_PROTOCOL_VERSION} · gpuLayers ${config.model.gpuLayers} · ctx ${config.model.contextWindow}`);
  if (!modelOk) w("  ! model file missing — set model.path in config.toml");
  if (!binOk) w("  ! llama-server not found — set inference.llamaServerBin");
  return modelOk && binOk ? 0 : 1;
}

async function restart(): Promise<number> {
  const config = defaultConfig(resolvePaths());
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
  const config = defaultConfig(resolvePaths());
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

  const input = args.join(" ").trim();
  const stdin = await readStdin();
  if (!input && !stdin) {
    process.stderr.write("usage: socius <question>   |   <cmd> | socius <question>\n");
    process.stderr.write("       socius doctor | restart\n");
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
