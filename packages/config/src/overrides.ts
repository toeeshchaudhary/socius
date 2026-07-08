/**
 * CLI-managed config overrides (`socius config set/unset`). These live in their
 * own file (config.cli.toml) layered over the hand-written config.toml, so the
 * CLI never rewrites — or strips comments from — the file the user edits by
 * hand, and `unset` cleanly falls back to the file/default value.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { type SociusPaths, resolvePaths } from "./paths.ts";

const HEADER = "# Managed by `socius config set` — do not hand-edit; use config.toml instead.\n";

export function readOverrides(paths: SociusPaths = resolvePaths()): Record<string, unknown> {
  if (!existsSync(paths.cliConfigFile)) return {};
  try {
    return parseToml(readFileSync(paths.cliConfigFile, "utf8")) as Record<string, unknown>;
  } catch (cause) {
    throw new Error(
      `invalid overrides at ${paths.cliConfigFile}: ${cause instanceof Error ? cause.message : cause}`,
    );
  }
}

/** Set a dotted key (e.g. "inference.remote.model") in the overrides file. */
export function setOverride(
  key: string,
  value: unknown,
  paths: SociusPaths = resolvePaths(),
): void {
  const overrides = readOverrides(paths);
  const segments = parseKey(key);
  let node: Record<string, unknown> = overrides;
  for (const seg of segments.slice(0, -1)) {
    const next = node[seg];
    if (typeof next !== "object" || next === null || Array.isArray(next)) node[seg] = {};
    node = node[seg] as Record<string, unknown>;
  }
  node[segments[segments.length - 1] as string] = value;
  write(overrides, paths);
}

/** Remove a dotted key from the overrides file; prunes emptied parent tables. */
export function unsetOverride(key: string, paths: SociusPaths = resolvePaths()): boolean {
  const overrides = readOverrides(paths);
  const segments = parseKey(key);
  const chain: Record<string, unknown>[] = [overrides];
  for (const seg of segments.slice(0, -1)) {
    const next = chain[chain.length - 1]?.[seg];
    if (typeof next !== "object" || next === null || Array.isArray(next)) return false;
    chain.push(next as Record<string, unknown>);
  }
  const leaf = segments[segments.length - 1] as string;
  const parent = chain[chain.length - 1] as Record<string, unknown>;
  if (!(leaf in parent)) return false;
  delete parent[leaf];
  for (let i = chain.length - 1; i > 0; i--) {
    const table = chain[i] as Record<string, unknown>;
    if (Object.keys(table).length === 0) delete chain[i - 1]?.[segments[i - 1] as string];
  }
  write(overrides, paths);
  return true;
}

/**
 * Flatten a config object into dotted key → value pairs (for get/list). Arrays
 * flatten with numeric segments ("mcp.0.name") so secret redaction, which is
 * per-key, still sees fields nested inside array entries.
 */
export function flatten(value: unknown, prefix = ""): [string, unknown][] {
  if (typeof value !== "object" || value === null) return [[prefix, value]];
  const entries = Array.isArray(value)
    ? value.map((v, i): [string, unknown] => [String(i), v])
    : Object.entries(value);
  if (entries.length === 0) return [[prefix, Array.isArray(value) ? [] : {}]];
  const out: [string, unknown][] = [];
  for (const [k, v] of entries) {
    out.push(...flatten(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

function parseKey(key: string): string[] {
  const segments = key.split(".").filter(Boolean);
  if (segments.length === 0) throw new Error(`invalid config key: '${key}'`);
  return segments;
}

function write(overrides: Record<string, unknown>, paths: SociusPaths): void {
  mkdirSync(dirname(paths.cliConfigFile), { recursive: true });
  // 0600: this file can hold API keys (`socius key set`).
  writeFileSync(paths.cliConfigFile, HEADER + stringifyToml(overrides), { mode: 0o600 });
}
