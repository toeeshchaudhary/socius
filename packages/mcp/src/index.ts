/**
 * @socius/mcp — Socius as an MCP client (M4). Each configured server is spawned
 * and its tools are wrapped by an adapter into the native `Tool` interface, so
 * the planner cannot distinguish MCP tools from built-ins. Tools are namespaced
 * by server (e.g. "gmail/search").
 */
import type { McpServerConfig, Result, Tool } from "@socius/core";
import { error } from "@socius/core";

export interface McpConnection {
  readonly name: string;
  listTools(): Promise<Result<readonly Tool[]>>;
  close(): Promise<void>;
}

export async function connectMcpServer(cfg: McpServerConfig): Promise<Result<McpConnection>> {
  return {
    ok: false,
    error: error("NOT_IMPLEMENTED", "mcp", `connect '${cfg.name}' (M4).`),
  };
}
