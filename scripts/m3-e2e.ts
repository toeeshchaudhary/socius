#!/usr/bin/env bun
/**
 * Live M3 check: the deterministic graph planner with real tools. Confirms the
 * decide slot produces valid JSON against the real model, the model chooses a
 * tool, the ToolRunner executes it under policy, and the answer uses the result.
 *
 * Usage: bun run scripts/m3-e2e.ts
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, resolvePaths } from "../packages/config/src/index.ts";
import { DaemonClient } from "../packages/cli/src/client.ts";
import { createDaemon } from "../packages/daemon/src/index.ts";

const dbFile = join(await mkdtemp(join(tmpdir(), "socius-m3-")), "db.sqlite");
const base = defaultConfig(resolvePaths());
const config = { ...base, storage: { ...base.storage, dbFile } };

const created = createDaemon(config);
if (!created.ok) throw created.error;
const daemon = created.value;
await daemon.start();
const client = (await DaemonClient.connect(config.daemon.socketPath))!;

async function ask(label: string, input: string) {
  process.stderr.write(`\n[m3] === ${label} ===\n[m3] q: ${input}\n[m3] --- answer ---\n`);
  let out = "";
  await client.infer({ input, maxTokens: 160 }, (t) => {
    out += t;
    process.stdout.write(t);
  });
  process.stdout.write("\n");
  return out;
}

// 1. Should trigger a tool (git.status / git.log on this repo).
await ask("tool: git", "What is the current git status of this repository? Summarize in one sentence.");
// 2. Should trigger fs.list.
await ask("tool: fs.list", "List the entries in the current directory, then say how many there are.");
// 3. Should answer directly, no tool.
await ask("no tool", "In one sentence, what is 2+2?");

client.close();
await daemon.stop();
await rm(dbFile, { force: true }).catch(() => {});
process.stderr.write("\n[m3] done.\n");
process.exit(0);
