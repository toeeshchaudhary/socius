#!/usr/bin/env bun
/**
 * A tiny local MCP server for testing Socius's MCP client. Exposes one read-only
 * tool that returns a value the base model cannot know. Speaks MCP over stdio.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "demo", version: "1.0.0" });

server.registerTool(
  "get_project_codename",
  {
    description: "Get the secret internal codename of the current project.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [{ type: "text", text: "The internal project codename is Falcon-Nine." }],
  }),
);

await server.connect(new StdioServerTransport());
