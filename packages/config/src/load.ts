/**
 * Layered config: built-in defaults ‹ config.toml ‹ environment. The TOML file is
 * deep-merged over the defaults, so a user sets only what they want to override.
 * String values support ${VAR} expansion, so secrets (API keys, headers) can come
 * from the environment instead of being written into the file.
 */
import { existsSync, readFileSync } from "node:fs";
import type { SociusConfig } from "@socius/core";
import { parse as parseToml } from "smol-toml";
import { defaultConfig } from "./index.ts";
import { type SociusPaths, resolvePaths } from "./paths.ts";

export function loadConfig(paths: SociusPaths = resolvePaths()): SociusConfig {
  // defaults ‹ config.toml (hand-written) ‹ config.cli.toml (socius config set)
  let merged: unknown = defaultConfig(paths);
  for (const file of [paths.configFile, paths.cliConfigFile]) {
    if (!existsSync(file)) continue;
    let parsed: unknown;
    try {
      parsed = parseToml(readFileSync(file, "utf8"));
    } catch (cause) {
      throw new Error(
        `invalid config at ${file}: ${cause instanceof Error ? cause.message : cause}`,
      );
    }
    merged = deepMerge(merged, expandEnv(parsed));
  }
  return merged as SociusConfig;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep-merge `over` onto `base`. Arrays replace; plain objects merge; scalars override. */
function deepMerge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (Array.isArray(over)) return over;
  if (isPlainObject(base) && isPlainObject(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const key of Object.keys(over)) {
      out[key] = key in base ? deepMerge(base[key], over[key]) : over[key];
    }
    return out;
  }
  return over;
}

/** Recursively expand ${VAR} references in string values. */
function expandEnv(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_m, name: string) => process.env[name] ?? "");
  }
  if (Array.isArray(value)) return value.map(expandEnv);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandEnv(v);
    return out;
  }
  return value;
}
