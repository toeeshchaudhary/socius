import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type SociusBackend, buildSociusMcpServer } from "./mcp-server.ts";

/** Fake daemon backend so the MCP server can be tested with no daemon/model. */
class FakeBackend implements SociusBackend {
  readonly remembered: string[] = [];
  async memSearch(query: string) {
    return {
      results: query.includes("blue")
        ? [{ content: "the sky is blue", kind: "long_term", score: 0.9 }]
        : [],
    };
  }
  async knowledgeSearch(query: string) {
    return {
      results: query.includes("socius")
        ? [{ content: "Socius uses SQLite", ref: "notes/x.md" }]
        : [],
    };
  }
  async remember(content: string) {
    this.remembered.push(content);
    return { id: "abcd1234-rest" };
  }
}

async function connectToServer(backend: SociusBackend): Promise<Client> {
  const server = buildSociusMcpServer(backend);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(ct);
  return client;
}

describe("Socius MCP server", () => {
  test("exposes memory + knowledge tools", async () => {
    const client = await connectToServer(new FakeBackend());
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["remember", "search_knowledge", "search_memory"]);
    await client.close();
  });

  test("search_memory proxies to the backend", async () => {
    const client = await connectToServer(new FakeBackend());
    const res = (await client.callTool({
      name: "search_memory",
      arguments: { query: "what color is the sky blue" },
    })) as {
      content: { text: string }[];
    };
    expect(res.content[0]?.text).toContain("the sky is blue");
    await client.close();
  });

  test("remember writes through to the backend", async () => {
    const backend = new FakeBackend();
    const client = await connectToServer(backend);
    await client.callTool({ name: "remember", arguments: { content: "cats are great" } });
    expect(backend.remembered).toContain("cats are great");
    await client.close();
  });
});
