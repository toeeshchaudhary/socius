/**
 * The Tool contract. Native tools and MCP tools implement the *identical*
 * interface — the planner cannot tell them apart (Principle #6). The registry
 * discovers tools dynamically; the planner selects by capability tag, never by
 * a hardcoded name.
 */
import type { ToolCallId } from "./ids.ts";
import type { Capability } from "./permissions.ts";
import type { Result } from "./result.ts";

export type ToolSource = "native" | "mcp";

export interface ToolContext {
  readonly callId: ToolCallId;
  readonly signal?: AbortSignal;
  /** Emit incremental progress/log lines from a long-running tool. */
  readonly onProgress?: (message: string) => void;
}

export interface ToolResult {
  /** Machine-readable output, validated against `outputSchema`. */
  readonly data: unknown;
  /** Optional short summary for the planner/user. */
  readonly summary?: string;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly source: ToolSource;
  /** JSON Schema for inputs — used for validation AND to describe the tool to the LLM. */
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly capabilities: readonly Capability[];
  /** Freeform tags the planner searches over: "git", "read", "summarize", ... */
  readonly capabilityTags: readonly string[];
  /** Destructive tools default to requiring confirmation. */
  readonly destructive: boolean;
  invoke(args: unknown, ctx: ToolContext): Promise<Result<ToolResult>>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  all(): readonly Tool[];
  /** Discovery: find tools whose capabilityTags match any of `tags`. */
  findByTags(tags: readonly string[]): readonly Tool[];
}
