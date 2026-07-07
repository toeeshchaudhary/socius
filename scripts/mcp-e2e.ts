#!/usr/bin/env bun
/**
 * Live M4 check: configure the daemon with a real MCP server (spawned over
 * stdio), then ask a question answerable only via that server's tool. Proves the
 * full chain: daemon -> MCP client -> wrapped Tool -> planner decide -> answer.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, resolvePaths } from "../packages/config/src/index.ts";
import { DaemonClient } from "../packages/cli/src/client.ts";
import { createDaemon } from "../packages/daemon/src/index.ts";

const dbFile = join(await mkdtemp(join(tmpdir(), "socius-mcp-")), "db.sqlite");
const serverScript = join(import.meta.dir, "mcp-server.ts");
const base = defaultConfig(resolvePaths());
const config = {
  ...base,
  storage: { ...base.storage, dbFile },
  mcp: [{ name: "demo", command: process.execPath, args: [serverScript], enabled: true }],
};

const created = createDaemon(config);
if (!created.ok) throw created.error;
const daemon = created.value;
await daemon.start();

const client = (await DaemonClient.connect(config.daemon.socketPath))!;
const h = (await client.health()) as unknown as { tools: number; mcp: { name: string; connected: boolean; toolCount: number }[] };
process.stderr.write(`[mcp] tools registered: ${h.tools}; mcp servers: ${JSON.stringify(h.mcp)}\n`);

process.stderr.write("[mcp] --- answer (needs the MCP tool) ---\n");
await client.infer(
  { input: "What is this project's secret internal codename? Use a tool to find out, then answer in one sentence.", maxTokens: 96 },
  (t) => process.stdout.write(t),
);
process.stdout.write("\n");

client.close();
await daemon.stop();
await rm(dbFile, { force: true }).catch(() => {});
process.stderr.write("[mcp] done.\n");
process.exit(0);
