#!/usr/bin/env bun
/**
 * Live check: the real daemon loads ~/.config/socius/config.toml, connects the
 * Composio MCP server over HTTP, and registers its tools alongside native ones.
 * Verifies the config loader + HTTP MCP transport end-to-end.
 */
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "../packages/cli/src/client.ts";
import { loadConfig, resolvePaths } from "../packages/config/src/index.ts";
import { createDaemon } from "../packages/daemon/src/index.ts";

const dbFile = join(tmpdir(), `socius-composio-${process.pid}.db`);
const base = loadConfig(resolvePaths()); // reads the real config.toml (composio)
const config = { ...base, storage: { ...base.storage, dbFile } };

const created = createDaemon(config);
if (!created.ok) throw created.error;
const daemon = created.value;
await daemon.start();

const client = (await DaemonClient.connect(config.daemon.socketPath))!;
const h = await client.health();
process.stderr.write(`[composio] total tools: ${h.tools}\n`);
for (const s of h.mcp ?? []) {
  process.stderr.write(
    `[composio] mcp '${s.name}': connected=${s.connected} tools=${s.toolCount}${s.error ? ` err=${s.error}` : ""}\n`,
  );
}

client.close();
await daemon.stop();
await rm(dbFile, { force: true }).catch(() => {});
process.stderr.write("[composio] done.\n");
process.exit(0);
