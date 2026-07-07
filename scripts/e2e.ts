#!/usr/bin/env bun
/**
 * In-process end-to-end check for the M1 spine. Exercises the real stack:
 * Daemon.start() (spawns + health-checks llama-server) → IPC socket server →
 * DaemonClient over the Unix socket → LlamaCppBackend streaming → DirectPlanner.
 *
 * Runs entirely in one process and stops llama-server before exiting, so it
 * leaves no lingering children. Not a hermetic unit test — needs the real model.
 *
 *   bun run scripts/e2e.ts "your prompt"
 */
import { defaultConfig, resolvePaths } from "../packages/config/src/index.ts";
import { DaemonClient } from "../packages/cli/src/client.ts";
import { createDaemon } from "../packages/daemon/src/index.ts";

const prompt = process.argv.slice(2).join(" ") || "Reply in one short sentence confirming you are online.";
const stdin = process.stdin.isTTY ? undefined : (await Bun.stdin.text()).trim() || undefined;

const config = defaultConfig(resolvePaths());
const created = createDaemon(config);
if (!created.ok) throw created.error;
const daemon = created.value;

const t0 = Date.now();
process.stderr.write("[e2e] starting daemon + loading model (CPU)…\n");
await daemon.start();
process.stderr.write(`[e2e] model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

const client = await DaemonClient.connect(config.daemon.socketPath);
if (!client) throw new Error("could not connect to daemon socket");

const hs = await client.handshake();
process.stderr.write(`[e2e] handshake ok: protocol=${hs.protocolVersion} model=${hs.modelId} ready=${hs.modelReady}\n`);

process.stderr.write(`[e2e] prompt: ${prompt}\n[e2e] --- streamed answer ---\n`);
const t1 = Date.now();
let tokens = 0;
await client.infer({ input: prompt, ...(stdin ? { stdin } : {}), maxTokens: 96 }, (text) => {
  tokens += 1;
  process.stdout.write(text);
});
process.stdout.write("\n");
process.stderr.write(`[e2e] --- done: ${tokens} tokens in ${((Date.now() - t1) / 1000).toFixed(1)}s ---\n`);

client.close();
await daemon.stop();
process.stderr.write("[e2e] daemon stopped cleanly. PASS.\n");
process.exit(0);
