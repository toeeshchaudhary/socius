/**
 * @socius/tools — the unified Tool interface + registry (M3). Native tools live
 * here; MCP tools are wrapped to the same interface by @socius/mcp. The registry
 * supports capability-tag discovery so the planner never hardcodes tool names.
 */
import type { Tool, ToolRegistry } from "@socius/core";

export class InMemoryToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }
  all(): readonly Tool[] {
    return [...this.tools.values()];
  }
  findByTags(tags: readonly string[]): readonly Tool[] {
    const want = new Set(tags);
    return this.all().filter((t) => t.capabilityTags.some((tag) => want.has(tag)));
  }
}
