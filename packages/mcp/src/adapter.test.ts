import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Tool } from "@socius/core";
import { asToolCallId } from "@socius/core";
import { mcpToolToNative } from "./adapter.ts";

const ctx = () => ({ callId: asToolCallId("c1") });

describe("mcpToolToNative", () => {
  let client: Client;
  let tools: Tool[];

  beforeEach(async () => {
    const server = new McpServer({ name: "srv", version: "1.0.0" });
    server.registerTool(
      "greet",
      { description: "Greet someone", inputSchema: { name: z.string() }, annotations: { readOnlyHint: true } },
      async ({ name }) => ({ content: [{ type: "text", text: `Hello, ${name}!` }] }),
    );
    server.registerTool(
      "wipe",
      { description: "Delete everything", inputSchema: { target: z.string() } },
      async ({ target }) => ({ content: [{ type: "text", text: `wiped ${target}` }] }),
    );

    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "socius", version: "0.0.0" });
    await client.connect(ct);
    const listed = await client.listTools();
    tools = listed.tools.map((t) => mcpToolToNative("srv", client, t));
  });

  afterEach(async () => {
    await client.close();
  });

  test("namespaces tools by server and preserves the input schema", () => {
    const greet = tools.find((t) => t.name === "srv/greet")!;
    expect(greet.source).toBe("mcp");
    expect((greet.inputSchema as { properties: object }).properties).toHaveProperty("name");
    expect(greet.capabilityTags).toContain("srv");
  });

  test("a readOnly tool is not destructive; an unannotated tool is (safe by default)", () => {
    const greet = tools.find((t) => t.name === "srv/greet")!;
    const wipe = tools.find((t) => t.name === "srv/wipe")!;
    expect(greet.destructive).toBe(false);
    expect(wipe.destructive).toBe(true); // no readOnlyHint -> treated as destructive
    expect(wipe.capabilities).toContain("net");
  });

  test("invoke performs the real MCP round-trip", async () => {
    const greet = tools.find((t) => t.name === "srv/greet")!;
    const r = await greet.invoke({ name: "Socius" }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value.data as { text: string }).text).toBe("Hello, Socius!");
  });
});
