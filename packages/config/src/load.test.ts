import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./load.ts";
import { resolvePaths } from "./paths.ts";

async function withConfig(toml: string) {
  const dir = await mkdtemp(join(tmpdir(), "socius-cfg-"));
  const configFile = join(dir, "config.toml");
  await writeFile(configFile, toml);
  const paths = { ...resolvePaths(), configFile };
  return { dir, config: loadConfig(paths) };
}

describe("loadConfig", () => {
  test("returns defaults when no file exists", () => {
    const paths = { ...resolvePaths(), configFile: "/nonexistent/socius/config.toml" };
    const c = loadConfig(paths);
    expect(c.model.contextWindow).toBeGreaterThan(0);
    expect(c.mcp).toEqual([]);
  });

  test("deep-merges TOML over defaults (scalars override, unset keys kept)", async () => {
    const { dir, config } = await withConfig(`
[model]
gpuLayers = 15

[permissions.policy]
"fs.write" = "allow"
`);
    expect(config.model.gpuLayers).toBe(15); // overridden
    expect(config.model.contextWindow).toBeGreaterThan(0); // default kept
    expect(config.permissions.policy["fs.write"]).toBe("allow"); // merged
    expect(config.permissions.policy["fs.read"]).toBe("allow"); // default kept
    await rm(dir, { recursive: true, force: true });
  });

  test("loads MCP servers (array replaces default)", async () => {
    const { dir, config } = await withConfig(`
[[mcp]]
name = "composio"
url = "https://example.com/mcp"
enabled = true
headers = { "x-api-key" = "literal-key" }
`);
    expect(config.mcp).toHaveLength(1);
    expect(config.mcp[0]!.name).toBe("composio");
    expect(config.mcp[0]!.url).toBe("https://example.com/mcp");
    expect(config.mcp[0]!.headers?.["x-api-key"]).toBe("literal-key");
    await rm(dir, { recursive: true, force: true });
  });

  test("expands ${ENV} references in string values", async () => {
    process.env.SOCIUS_TEST_SECRET = "s3cr3t";
    const { dir, config } = await withConfig(`
[[mcp]]
name = "x"
url = "https://x/mcp"
enabled = true
headers = { "x-api-key" = "\${SOCIUS_TEST_SECRET}" }
`);
    expect(config.mcp[0]!.headers?.["x-api-key"]).toBe("s3cr3t");
    delete process.env.SOCIUS_TEST_SECRET;
    await rm(dir, { recursive: true, force: true });
  });
});
