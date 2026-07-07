/**
 * McpManager — Socius as an MCP client. Spawns each configured server, lists its
 * tools, wraps them as native Tools, and registers them. Resilient (Principle #2):
 * a server that fails to start is skipped and reported; it never crashes the
 * daemon, and native tools keep working.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Logger, McpServerConfig, ToolRegistry } from "@socius/core";
import { mcpToolToNative } from "./adapter.ts";

export interface McpServerStatus {
  readonly name: string;
  readonly connected: boolean;
  readonly toolCount: number;
  readonly error?: string;
}

interface Connection {
  name: string;
  client: Client;
}

export class McpManager {
  private readonly connections: Connection[] = [];
  private readonly statuses: McpServerStatus[] = [];

  constructor(private readonly logger: Logger) {}

  /** Connect all enabled servers and register their tools. Never throws. */
  async connectAll(configs: readonly McpServerConfig[], registry: ToolRegistry): Promise<void> {
    for (const cfg of configs) {
      if (!cfg.enabled) continue;
      await this.connectOne(cfg, registry);
    }
  }

  private async connectOne(cfg: McpServerConfig, registry: ToolRegistry): Promise<void> {
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
      Object.assign(env, cfg.env ?? {});

      const transport = new StdioClientTransport({
        command: cfg.command,
        args: [...(cfg.args ?? [])],
        env,
      });
      const client = new Client({ name: "socius", version: "0.0.0" });
      await client.connect(transport);

      const { tools } = await client.listTools();
      for (const t of tools) registry.register(mcpToolToNative(cfg.name, client, t));

      this.connections.push({ name: cfg.name, client });
      this.statuses.push({ name: cfg.name, connected: true, toolCount: tools.length });
      this.logger.info("mcp server connected", { server: cfg.name, tools: tools.length });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.statuses.push({ name: cfg.name, connected: false, toolCount: 0, error: message });
      this.logger.warn("mcp server failed to connect", { server: cfg.name, err: message });
    }
  }

  status(): readonly McpServerStatus[] {
    return this.statuses;
  }

  async close(): Promise<void> {
    for (const c of this.connections) {
      await c.client.close().catch(() => {});
    }
    this.connections.length = 0;
  }
}
