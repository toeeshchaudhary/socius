#!/usr/bin/env bun
/**
 * sociusd entrypoint. Normally lazy-spawned by the CLI, but runnable directly
 * for debugging: `bun run packages/daemon/src/main.ts`.
 */
import { defaultConfig, resolvePaths } from "@socius/config";
import { createDaemon } from "./index.ts";

const config = defaultConfig(resolvePaths());
const created = createDaemon(config);
if (!created.ok) {
  process.stderr.write(`sociusd: ${created.error.message}\n`);
  process.exit(1);
}

try {
  await created.value.start();
} catch (err) {
  process.stderr.write(`sociusd: failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
