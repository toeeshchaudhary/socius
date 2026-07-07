#!/usr/bin/env bun
/** Live: can the model actually call a Composio (remote HTTP MCP) tool via the graph? */
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolvePaths } from "../packages/config/src/index.ts";
import { DaemonClient } from "../packages/cli/src/client.ts";
import { createDaemon } from "../packages/daemon/src/index.ts";

const dbFile = join(tmpdir(), `socius-cu-${process.pid}.db`);
const base = loadConfig(resolvePaths());
const config = { ...base, storage: { ...base.storage, dbFile } };
const created = createDaemon(config);
if (!created.ok) throw created.error;
const daemon = created.value;
await daemon.start();
const client = (await DaemonClient.connect(config.daemon.socketPath))!;

process.stderr.write("[cu] --- answer ---\n");
await client.infer(
  { input: "Use the Composio search tool to find tools for sending email. What did you find?", maxTokens: 220 },
  (t) => process.stdout.write(t),
  async (p) => {
    process.stderr.write(`\n[cu] CONFIRM -> approving: ${p.slice(0, 90)}\n`);
    return true;
  },
);
process.stdout.write("\n");
client.close();
await daemon.stop();
await rm(dbFile, { force: true }).catch(() => {});
process.exit(0);
