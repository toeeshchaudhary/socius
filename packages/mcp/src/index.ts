/**
 * @socius/mcp — Socius as an MCP client (M4). Each configured server is spawned
 * and its tools are wrapped by an adapter into the native `Tool` interface, so
 * the planner cannot distinguish MCP tools from built-ins. Tools are namespaced
 * by server (e.g. "gmail/search").
 */
export { mcpToolToNative } from "./adapter.ts";
export { McpManager, type McpServerStatus } from "./manager.ts";
