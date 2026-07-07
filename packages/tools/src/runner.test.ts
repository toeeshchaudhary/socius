import { describe, expect, test } from "bun:test";
import type { ConfirmationProvider, PermissionRequest, Result } from "@socius/core";
import { asToolCallId, ok } from "@socius/core";
import { ConfiguredPolicyEngine } from "@socius/permissions";
import { ToolRunner } from "./runner.ts";
import { fsListTool, fsReadTool } from "./native/fs.ts";
import { gitStatusTool } from "./native/git.ts";

const ctx = () => ({ callId: asToolCallId("c1") });

const yes: ConfirmationProvider = { async confirm(): Promise<Result<boolean>> { return ok(true); } };
const no: ConfirmationProvider = { async confirm(): Promise<Result<boolean>> { return ok(false); } };

const policy = new ConfiguredPolicyEngine({
  "fs.read": "allow",
  "fs.write": "confirm",
  secrets: "deny",
});

describe("ToolRunner permission enforcement", () => {
  test("allows an fs.read tool without confirmation", async () => {
    const runner = new ToolRunner(policy);
    const r = await runner.run(fsListTool, { path: process.cwd() }, {
      mode: "live",
      reasoning: "list cwd",
      ctx: ctx(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value.data as { entries: string[] }).entries.length).toBeGreaterThan(0);
  });

  test("dry-run never invokes the tool", async () => {
    const runner = new ToolRunner(policy);
    const r = await runner.run(fsReadTool, { path: "/nonexistent/should-not-be-read" }, {
      mode: "dry_run",
      reasoning: "preview",
      ctx: ctx(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value.data as { dryRun: boolean }).dryRun).toBe(true);
  });

  test("a confirm-required capability is denied when the user declines", async () => {
    // A tool needing a confirm capability
    const writeTool = { ...fsReadTool, name: "fake.write", capabilities: ["fs.write"] as const, destructive: true };
    const runner = new ToolRunner(policy, no);
    const r = await runner.run(writeTool, { path: "x" }, { mode: "live", reasoning: "write", ctx: ctx() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PERMISSION_DENIED");
  });

  test("a confirm-required capability proceeds when the user accepts", async () => {
    const writeTool = { ...fsListTool, name: "fake.write2", capabilities: ["fs.write"] as const, destructive: true };
    const runner = new ToolRunner(policy, yes);
    const r = await runner.run(writeTool, { path: process.cwd() }, { mode: "live", reasoning: "write", ctx: ctx() });
    expect(r.ok).toBe(true);
  });

  test("without a confirmer, a confirm-required tool errors CONFIRMATION_REQUIRED", async () => {
    const writeTool = { ...fsReadTool, name: "fake.write3", capabilities: ["fs.write"] as const, destructive: true };
    const runner = new ToolRunner(policy);
    const r = await runner.run(writeTool, { path: "x" }, { mode: "live", reasoning: "write", ctx: ctx() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CONFIRMATION_REQUIRED");
  });
});

describe("native tools", () => {
  test("fs.read validates input", async () => {
    const r = await fsReadTool.invoke({}, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("TOOL_INPUT_INVALID");
  });

  test("git.status runs on this repo", async () => {
    const r = await gitStatusTool.invoke({ cwd: process.cwd() }, ctx());
    // this repo is a git repo; expect success with a string
    expect(r.ok).toBe(true);
    if (r.ok) expect(typeof (r.value.data as { status: string }).status).toBe("string");
  });
});
