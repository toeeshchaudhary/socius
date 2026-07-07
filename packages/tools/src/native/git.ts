/**
 * Git tools. These are read-only (status/diff/log). They run `git` as a
 * subprocess but only inspect repository state, so they declare `fs.read` (the
 * effect) rather than `exec`, and are not destructive. Mutating git operations
 * (commit/push) will be separate tools declaring `exec` + destructive.
 */
import type { Result, Tool, ToolContext, ToolResult } from "@socius/core";
import { error, ok } from "@socius/core";

function runGit(cwd: string, args: string[]): Result<string> {
  try {
    const proc = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode !== 0) {
      const msg = new TextDecoder().decode(proc.stderr).trim() || `git exited ${proc.exitCode}`;
      return { ok: false, error: error("TOOL_FAILED", "tools", msg) };
    }
    return ok(new TextDecoder().decode(proc.stdout));
  } catch (cause) {
    return { ok: false, error: error("TOOL_FAILED", "tools", "failed to run git", { cause }) };
  }
}

function cwdOf(args: unknown): string {
  const c = (args as { cwd?: unknown })?.cwd;
  return typeof c === "string" && c.length > 0 ? c : process.cwd();
}

const cwdSchema = {
  type: "object",
  properties: { cwd: { type: "string", description: "Repository path (default: current directory)" } },
};

export const gitStatusTool: Tool = {
  name: "git.status",
  description: "Show the working-tree status of a git repository (short format).",
  source: "native",
  inputSchema: cwdSchema,
  outputSchema: { type: "object", properties: { status: { type: "string" } } },
  capabilities: ["fs.read"],
  capabilityTags: ["git", "read", "status"],
  destructive: false,
  async invoke(args: unknown, _ctx: ToolContext): Promise<Result<ToolResult>> {
    const r = runGit(cwdOf(args), ["status", "--short", "--branch"]);
    if (!r.ok) return r;
    return ok({ data: { status: r.value }, summary: "git status" });
  },
};

export const gitDiffTool: Tool = {
  name: "git.diff",
  description: "Show the diff of unstaged (or staged, with staged=true) changes.",
  source: "native",
  inputSchema: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Repository path (default: current directory)" },
      staged: { type: "boolean", description: "Show staged changes instead of unstaged" },
    },
  },
  outputSchema: { type: "object", properties: { diff: { type: "string" } } },
  capabilities: ["fs.read"],
  capabilityTags: ["git", "read", "diff"],
  destructive: false,
  async invoke(args: unknown, _ctx: ToolContext): Promise<Result<ToolResult>> {
    const staged = (args as { staged?: unknown })?.staged === true;
    const r = runGit(cwdOf(args), staged ? ["diff", "--staged"] : ["diff"]);
    if (!r.ok) return r;
    return ok({ data: { diff: r.value }, summary: `git diff${staged ? " --staged" : ""}` });
  },
};

export const gitAddTool: Tool = {
  name: "git.add",
  description: "Stage files for commit (git add). Destructive to the staging area.",
  source: "native",
  inputSchema: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Repository path (default: current directory)" },
      paths: { type: "array", items: { type: "string" }, description: "Paths to stage (default: all changes)" },
    },
  },
  outputSchema: { type: "object", properties: { staged: { type: "string" } } },
  capabilities: ["fs.write"],
  capabilityTags: ["git", "write", "stage", "add"],
  destructive: true,
  async invoke(args: unknown, _ctx: ToolContext): Promise<Result<ToolResult>> {
    const paths = (args as { paths?: unknown })?.paths;
    const list = Array.isArray(paths) && paths.length > 0 ? paths.map(String) : ["-A"];
    const r = runGit(cwdOf(args), ["add", ...list]);
    if (!r.ok) return r;
    return ok({ data: { staged: list.join(" ") }, summary: `git add ${list.join(" ")}` });
  },
};

export const gitCommitTool: Tool = {
  name: "git.commit",
  description: "Create a commit with a message (git commit -m). Destructive — writes history.",
  source: "native",
  inputSchema: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Repository path (default: current directory)" },
      message: { type: "string", description: "Commit message" },
      all: { type: "boolean", description: "Stage all tracked changes first (git commit -a)" },
    },
    required: ["message"],
  },
  outputSchema: { type: "object", properties: { commit: { type: "string" } } },
  capabilities: ["fs.write"],
  capabilityTags: ["git", "write", "commit"],
  destructive: true,
  async invoke(args: unknown, _ctx: ToolContext): Promise<Result<ToolResult>> {
    const a = args as { message?: unknown; all?: unknown };
    if (typeof a.message !== "string" || a.message.trim().length === 0) {
      return { ok: false, error: error("TOOL_INPUT_INVALID", "tools", "`message` (non-empty string) is required") };
    }
    const flags = a.all === true ? ["-a"] : [];
    const r = runGit(cwdOf(args), ["commit", ...flags, "-m", a.message]);
    if (!r.ok) return r;
    return ok({ data: { commit: r.value.trim() }, summary: "git commit" });
  },
};

export const gitLogTool: Tool = {
  name: "git.log",
  description: "Show recent commit history (one line per commit).",
  source: "native",
  inputSchema: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Repository path (default: current directory)" },
      limit: { type: "number", description: "Number of commits (default 10)" },
    },
  },
  outputSchema: { type: "object", properties: { log: { type: "string" } } },
  capabilities: ["fs.read"],
  capabilityTags: ["git", "read", "log", "history"],
  destructive: false,
  async invoke(args: unknown, _ctx: ToolContext): Promise<Result<ToolResult>> {
    const limitRaw = (args as { limit?: unknown })?.limit;
    const limit = typeof limitRaw === "number" && limitRaw > 0 ? Math.min(limitRaw, 100) : 10;
    const r = runGit(cwdOf(args), ["log", `-n${limit}`, "--oneline", "--decorate"]);
    if (!r.ok) return r;
    return ok({ data: { log: r.value }, summary: `git log -n${limit}` });
  },
};
