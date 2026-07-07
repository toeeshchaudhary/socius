/**
 * Socius as an MCP *server* — exposes your second brain (memory + knowledge) to
 * any MCP client (e.g. Claude Desktop). It proxies to the running sociusd over
 * the same IPC the CLI uses, so all state stays owned by the daemon.
 *
 * Add to a client's MCP config:
 *   { "mcpServers": { "socius": { "command": "socius", "args": ["serve"] } } }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, resolvePaths } from "@socius/config";
import { z } from "zod";
import { ensureDaemon } from "./client.ts";

/** The subset of the daemon client the MCP server proxies to. */
export interface SociusBackend {
  memSearch(
    query: string,
    k?: number,
  ): Promise<{ results: { content: string; kind: string; score: number }[] }>;
  knowledgeSearch(query: string): Promise<{ results: { content: string; ref?: string }[] }>;
  remember(content: string): Promise<{ id: string }>;
}

/** Build the Socius MCP server (tools registered, not yet connected to a transport). */
export function buildSociusMcpServer(client: SociusBackend): McpServer {
  const server = new McpServer({ name: "socius", version: "0.0.0" });

  server.registerTool(
    "search_memory",
    {
      description:
        "Search Socius's long-term memory (facts, preferences, decisions the user told Socius to remember).",
      inputSchema: { query: z.string().describe("What to look for"), limit: z.number().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => {
      const { results } = await client.memSearch(query, limit);
      const text = results.length
        ? results.map((r) => `- (${r.kind}) ${r.content}`).join("\n")
        : "No matching memories.";
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "search_knowledge",
    {
      description: "Search Socius's Markdown knowledge base (the user's notes, projects, journal).",
      inputSchema: { query: z.string().describe("What to look for") },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const { results } = await client.knowledgeSearch(query);
      const text = results.length
        ? results.map((r) => `- [${r.ref ?? "?"}] ${r.content}`).join("\n")
        : "No matching knowledge.";
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "remember",
    {
      description: "Save a fact to Socius's long-term memory for later recall.",
      inputSchema: { content: z.string().describe("The fact to remember") },
      annotations: { readOnlyHint: false },
    },
    async ({ content }) => {
      const { id } = await client.remember(content);
      return { content: [{ type: "text", text: `Remembered (${id.slice(0, 8)}).` }] };
    },
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const config = loadConfig(resolvePaths());
  const client = await ensureDaemon(config);
  const server = buildSociusMcpServer(client);

  // stdout is the MCP transport here; the daemon client logs to stderr only.
  await server.connect(new StdioServerTransport());

  // Stay alive until the client closes stdin; then exit cleanly.
  await new Promise<void>((resolve) => {
    process.stdin.on("end", resolve);
    process.stdin.on("close", resolve);
  });
  client.close();
}
