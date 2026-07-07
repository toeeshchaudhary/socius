#!/usr/bin/env bun
/**
 * Live knowledge-base check: write a Markdown note with a distinctive fact,
 * index it, then ask a question that requires it. Exercises indexing +
 * retrieval-augmented answering against the running model.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "../packages/cli/src/client.ts";
import { defaultConfig, resolvePaths } from "../packages/config/src/index.ts";
import { createDaemon } from "../packages/daemon/src/index.ts";

const kb = await mkdtemp(join(tmpdir(), "socius-kb-e2e-"));
const dbFile = join(kb, "db.sqlite");
await writeFile(
  join(kb, "infra.md"),
  "---\ntitle: Infra notes\ntags: [infra]\n---\n\nThe production database for Project Nimbus runs on port 6789 and is backed up every night at 02:30.\n",
);

const base = defaultConfig(resolvePaths());
const config = { ...base, storage: { dbFile, knowledgeDir: kb } };
const daemon = (() => {
  const c = createDaemon(config);
  if (!c.ok) throw c.error;
  return c.value;
})();
await daemon.start();

const client = (await DaemonClient.connect(config.daemon.socketPath))!;
const idx = await client.knowledgeIndex();
process.stderr.write(`[kb] indexed ${idx.files} file(s), ${idx.chunks} chunk(s)\n`);

const search = await client.knowledgeSearch("production database port");
process.stderr.write(
  `[kb] search -> ${search.results.length} hit(s); top: ${search.results[0]?.content?.slice(0, 60)}\n`,
);

process.stderr.write("[kb] --- answer (needs the indexed note) ---\n");
await client.infer(
  {
    input:
      "What port does the Project Nimbus production database run on? Answer in one short sentence.",
    maxTokens: 48,
  },
  (t) => process.stdout.write(t),
);
process.stdout.write("\n");

client.close();
await daemon.stop();
await rm(kb, { recursive: true, force: true }).catch(() => {});
process.stderr.write("[kb] done.\n");
process.exit(0);
