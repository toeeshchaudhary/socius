import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asToolCallId } from "@socius/core";
import { gitAddTool, gitCommitTool, gitStatusTool } from "./native/git.ts";

const ctx = () => ({ callId: asToolCallId("c1") });

describe("git write tools (temp repo)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "socius-git-"));
    Bun.spawnSync(["git", "-C", dir, "init", "-q"]);
    Bun.spawnSync(["git", "-C", dir, "config", "user.email", "t@t.t"]);
    Bun.spawnSync(["git", "-C", dir, "config", "user.name", "t"]);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("git.add then git.commit creates a commit", async () => {
    await writeFile(join(dir, "a.txt"), "hello");
    const add = await gitAddTool.invoke({ cwd: dir }, ctx());
    expect(add.ok).toBe(true);
    const commit = await gitCommitTool.invoke({ cwd: dir, message: "init" }, ctx());
    expect(commit.ok).toBe(true);

    const log = Bun.spawnSync(["git", "-C", dir, "log", "--oneline"]);
    expect(new TextDecoder().decode(log.stdout)).toContain("init");
  });

  test("git.commit requires a non-empty message", async () => {
    const r = await gitCommitTool.invoke({ cwd: dir, message: "" }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("TOOL_INPUT_INVALID");
  });

  test("write tools are marked destructive", () => {
    expect(gitCommitTool.destructive).toBe(true);
    expect(gitAddTool.destructive).toBe(true);
    expect(gitStatusTool.destructive).toBe(false);
  });
});
