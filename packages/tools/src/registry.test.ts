import { describe, expect, test } from "bun:test";
import type { Tool, ToolContext, ToolResult } from "@socius/core";
import { type Result, ok } from "@socius/core";
import { InMemoryToolRegistry } from "./index.ts";

const fakeTool = (name: string, tags: string[]): Tool => ({
  name,
  description: name,
  source: "native",
  inputSchema: {},
  outputSchema: {},
  capabilities: [],
  capabilityTags: tags,
  destructive: false,
  async invoke(_a: unknown, _c: ToolContext): Promise<Result<ToolResult>> {
    return ok({ data: null });
  },
});

describe("InMemoryToolRegistry", () => {
  test("registers and retrieves by name", () => {
    const reg = new InMemoryToolRegistry();
    reg.register(fakeTool("git.diff", ["git", "read"]));
    expect(reg.get("git.diff")?.name).toBe("git.diff");
    expect(reg.all()).toHaveLength(1);
  });

  test("discovers tools by capability tag", () => {
    const reg = new InMemoryToolRegistry();
    reg.register(fakeTool("git.diff", ["git", "read"]));
    reg.register(fakeTool("fs.read", ["fs", "read"]));
    reg.register(fakeTool("net.fetch", ["net"]));

    expect(
      reg
        .findByTags(["read"])
        .map((t) => t.name)
        .sort(),
    ).toEqual(["fs.read", "git.diff"]);
    expect(reg.findByTags(["git"]).map((t) => t.name)).toEqual(["git.diff"]);
    expect(reg.findByTags(["nonexistent"])).toHaveLength(0);
  });
});
