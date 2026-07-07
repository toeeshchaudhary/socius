#!/usr/bin/env bun
/**
 * Live check: the model drives git.add + git.commit (destructive tools) through
 * the confirmation flow. Runs in a throwaway temp repo; the confirmer here
 * auto-approves (a real terminal would prompt the user).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "../packages/cli/src/client.ts";
import { defaultConfig, resolvePaths } from "../packages/config/src/index.ts";
import { createDaemon } from "../packages/daemon/src/index.ts";

const repo = await mkdtemp(join(tmpdir(), "socius-commit-"));
Bun.spawnSync(["git", "-C", repo, "init", "-q"]);
Bun.spawnSync(["git", "-C", repo, "config", "user.email", "t@t.t"]);
Bun.spawnSync(["git", "-C", repo, "config", "user.name", "Tester"]);
await writeFile(join(repo, "hello.py"), "print('hello world')\n");
process.chdir(repo); // native git tools default to process.cwd()

const base = defaultConfig(resolvePaths());
const config = { ...base, storage: { ...base.storage, dbFile: join(repo, "db.sqlite") } };
const created = createDaemon(config);
if (!created.ok) throw created.error;
const daemon = created.value;
await daemon.start();
const client = (await DaemonClient.connect(config.daemon.socketPath))!;

process.stderr.write("[commit] asking the model to stage + commit…\n[commit] --- answer ---\n");
await client.infer(
  {
    input:
      "Stage all changes in this repo and commit them with a short one-line message. Use the git tools.",
    maxTokens: 200,
  },
  (t) => process.stdout.write(t),
  async (prompt) => {
    process.stderr.write(`\n[commit] CONFIRM requested -> auto-approving: ${prompt}\n`);
    return true;
  },
);
process.stdout.write("\n");

const log = Bun.spawnSync(["git", "-C", repo, "log", "--oneline"]);
process.stderr.write(
  `[commit] git log: ${new TextDecoder().decode(log.stdout).trim() || "(no commits)"}\n`,
);

client.close();
await daemon.stop();
await rm(repo, { recursive: true, force: true }).catch(() => {});
process.exit(0);
