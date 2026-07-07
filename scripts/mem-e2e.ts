#!/usr/bin/env bun
/**
 * Live memory check: teach the daemon a fact the base model cannot know, then
 * ask about it. If memory retrieval + injection works, the answer contains the
 * fact. Uses a temp DB and the running llama-server (adopted). Cleans up.
 */
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, resolvePaths } from "../packages/config/src/index.ts";
import { DaemonClient } from "../packages/cli/src/client.ts";
import { createDaemon } from "../packages/daemon/src/index.ts";

const dbFile = join(tmpdir(), `socius-mem-e2e-${process.pid}.db`);
const base = defaultConfig(resolvePaths());
const config = { ...base, storage: { ...base.storage, dbFile } };

const created = createDaemon(config);
if (!created.ok) throw created.error;
const daemon = created.value;
await daemon.start();
process.stderr.write("[mem] daemon started (memory on temp db)\n");

const client = (await DaemonClient.connect(config.daemon.socketPath))!;

// A fact the model has no way to know.
const fact = "The internal codename for the Socius release is Bluefin, and it ships on a Thursday.";
const { id } = await client.remember(fact, "project");
process.stderr.write(`[mem] remembered: ${id.slice(0, 8)}\n`);

const listed = (await client.memList(undefined, 10)).memories;
process.stderr.write(`[mem] mem.list -> ${listed.length} memory(ies)\n`);

process.stderr.write("[mem] asking a question that requires the remembered fact…\n");
process.stderr.write("[mem] --- answer ---\n");
let n = 0;
await client.infer(
  { input: "What is the internal codename for the Socius release? Answer in one short sentence.", maxTokens: 48 },
  (t) => {
    n++;
    process.stdout.write(t);
  },
);
process.stdout.write("\n");
process.stderr.write(`[mem] streamed ${n} tokens\n`);

client.close();
await daemon.stop();
await rm(dbFile, { force: true }).catch(() => {});
await rm(`${dbFile}-shm`, { force: true }).catch(() => {});
await rm(`${dbFile}-wal`, { force: true }).catch(() => {});
process.stderr.write("[mem] done, cleaned up.\n");
process.exit(0);
