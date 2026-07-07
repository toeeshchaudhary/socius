/**
 * Filesystem tools. Read-only tools declare `fs.read`; mutating tools declare
 * `fs.write`/`fs.delete` and are `destructive` (confirmation by default). The
 * capability describes the *effect*, which is what the permission layer governs.
 */
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { Result, Tool, ToolContext, ToolResult } from "@socius/core";
import { error, ok } from "@socius/core";

const MAX_READ_BYTES = 256 * 1024;

function badInput(msg: string) {
  return { ok: false as const, error: error("TOOL_INPUT_INVALID", "tools", msg) };
}

export const fsReadTool: Tool = {
  name: "fs.read",
  description: "Read the contents of a text file. Returns up to 256KB.",
  source: "native",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Absolute or relative file path" } },
    required: ["path"],
  },
  outputSchema: { type: "object", properties: { content: { type: "string" }, path: { type: "string" } } },
  capabilities: ["fs.read"],
  capabilityTags: ["fs", "read", "file"],
  destructive: false,
  async invoke(args: unknown, _ctx: ToolContext): Promise<Result<ToolResult>> {
    const path = (args as { path?: unknown })?.path;
    if (typeof path !== "string" || path.length === 0) return badInput("`path` (string) is required");
    const abs = resolve(path);
    try {
      const s = await stat(abs);
      if (!s.isFile()) return badInput(`${abs} is not a file`);
      const buf = await readFile(abs);
      const truncated = buf.length > MAX_READ_BYTES;
      const content = buf.subarray(0, MAX_READ_BYTES).toString("utf8");
      return ok({
        data: { path: abs, content, truncated, bytes: s.size },
        summary: `read ${basename(abs)} (${s.size} bytes${truncated ? ", truncated" : ""})`,
      });
    } catch (cause) {
      return { ok: false, error: error("TOOL_FAILED", "tools", `cannot read ${abs}`, { cause }) };
    }
  },
};

export const fsWriteTool: Tool = {
  name: "fs.write",
  description: "Write text content to a file, creating or overwriting it. Destructive.",
  source: "native",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write" },
      content: { type: "string", description: "Text content to write" },
    },
    required: ["path", "content"],
  },
  outputSchema: { type: "object", properties: { path: { type: "string" }, bytes: { type: "number" } } },
  capabilities: ["fs.write"],
  capabilityTags: ["fs", "write", "file"],
  destructive: true,
  async invoke(args: unknown, _ctx: ToolContext): Promise<Result<ToolResult>> {
    const a = args as { path?: unknown; content?: unknown };
    if (typeof a.path !== "string" || a.path.length === 0) return badInput("`path` (string) is required");
    if (typeof a.content !== "string") return badInput("`content` (string) is required");
    const abs = resolve(a.path);
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, a.content, "utf8");
      return ok({ data: { path: abs, bytes: Buffer.byteLength(a.content) }, summary: `wrote ${basename(abs)}` });
    } catch (cause) {
      return { ok: false, error: error("TOOL_FAILED", "tools", `cannot write ${abs}`, { cause }) };
    }
  },
};

export const fsListTool: Tool = {
  name: "fs.list",
  description: "List the entries in a directory.",
  source: "native",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Directory path (default: current directory)" } },
  },
  outputSchema: { type: "object", properties: { entries: { type: "array", items: { type: "string" } } } },
  capabilities: ["fs.read"],
  capabilityTags: ["fs", "list", "directory"],
  destructive: false,
  async invoke(args: unknown, _ctx: ToolContext): Promise<Result<ToolResult>> {
    const path = (args as { path?: unknown })?.path;
    const target = typeof path === "string" && path.length > 0 ? resolve(path) : process.cwd();
    try {
      const names = await readdir(target, { withFileTypes: true });
      const entries = names.map((d) => (d.isDirectory() ? `${d.name}/` : d.name)).sort();
      return ok({ data: { path: target, entries }, summary: `${entries.length} entries in ${target}` });
    } catch (cause) {
      return { ok: false, error: error("TOOL_FAILED", "tools", `cannot list ${target}`, { cause }) };
    }
  },
};
