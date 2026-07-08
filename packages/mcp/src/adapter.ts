/**
 * Wraps a remote MCP tool as a native `Tool` (Principle #6: the planner cannot
 * tell them apart). Tools are namespaced by server ("gmail/search"). Safety
 * mapping: a tool is treated as destructive (→ confirmation) unless it declares
 * `readOnlyHint`, so unknown remote tools are safe by default.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import type { Capability, Result, Tool, ToolContext, ToolResult } from "@socius/core";
import { error, ok } from "@socius/core";

interface CallToolResult {
  content?: { type: string; text?: string }[];
  isError?: boolean;
}

export function mcpToolToNative(serverName: string, client: Client, mcp: McpTool): Tool {
  const readOnly = mcp.annotations?.readOnlyHint === true;
  const destructive = !readOnly || mcp.annotations?.destructiveHint === true;
  const capabilities: Capability[] = readOnly ? [] : ["net"];
  const nameTokens = mcp.name.split(/[^a-z0-9]+/i).filter(Boolean);

  return {
    name: `${serverName}/${mcp.name}`,
    description: mcp.description ?? `${mcp.name} (via ${serverName})`,
    source: "mcp",
    inputSchema: mcp.inputSchema ?? { type: "object" },
    outputSchema: { type: "object", properties: { text: { type: "string" } } },
    capabilities,
    capabilityTags: [serverName, ...nameTokens, readOnly ? "read" : "write"],
    destructive,
    async invoke(args: unknown, ctx: ToolContext): Promise<Result<ToolResult>> {
      try {
        const res = (await client.callTool(
          { name: mcp.name, arguments: (args ?? {}) as Record<string, unknown> },
          undefined,
          ctx.signal ? { signal: ctx.signal } : undefined,
        )) as CallToolResult;
        const text = (res.content ?? [])
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text)
          .join("\n");
        if (res.isError) {
          return {
            ok: false,
            error: error("TOOL_FAILED", "mcp", text || `${mcp.name} reported an error`),
          };
        }
        // The summary feeds the decide/plan slots on later loop iterations, so it
        // must carry the result itself — a bare tool name starves the loop and the
        // model just re-calls the same tool instead of acting on what it returned.
        const summary =
          text.trim().slice(0, 800) || `${serverName}/${mcp.name}: ok (no text output)`;
        return ok({
          data: { content: res.content ?? [], text },
          summary,
        });
      } catch (cause) {
        return {
          ok: false,
          error: error("TOOL_FAILED", "mcp", `MCP call ${mcp.name} failed`, { cause }),
        };
      }
    },
  };
}
