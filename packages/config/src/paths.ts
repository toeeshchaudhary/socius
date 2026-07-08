/**
 * XDG-compliant path resolution. Socius keeps a strict separation:
 *  - config   (~/.config/socius)          hand-editable TOML
 *  - data     (~/.local/share/socius)     SQLite DB + Markdown knowledge base
 *  - state    (~/.local/state/socius)     logs, traces
 *  - runtime  ($XDG_RUNTIME_DIR/socius)   the Unix socket + pidfile (tmpfs)
 */
import { homedir } from "node:os";
import { join } from "node:path";

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.length > 0 ? v : undefined;
};

export interface SociusPaths {
  readonly configDir: string;
  readonly dataDir: string;
  readonly stateDir: string;
  readonly runtimeDir: string;
  readonly configFile: string;
  /** CLI-managed overrides (`socius config set`), layered over configFile. */
  readonly cliConfigFile: string;
  readonly dbFile: string;
  readonly knowledgeDir: string;
  readonly promptsDir: string;
  readonly socketPath: string;
  readonly pidPath: string;
}

export function resolvePaths(): SociusPaths {
  const home = homedir();
  const configDir = join(env("XDG_CONFIG_HOME") ?? join(home, ".config"), "socius");
  const dataDir = join(env("XDG_DATA_HOME") ?? join(home, ".local", "share"), "socius");
  const stateDir = join(env("XDG_STATE_HOME") ?? join(home, ".local", "state"), "socius");
  const runtimeDir = join(
    env("XDG_RUNTIME_DIR") ?? `/tmp/socius-${process.getuid?.() ?? 0}`,
    "socius",
  );

  return {
    configDir,
    dataDir,
    stateDir,
    runtimeDir,
    configFile: join(configDir, "config.toml"),
    cliConfigFile: join(configDir, "config.cli.toml"),
    dbFile: join(dataDir, "socius.db"),
    knowledgeDir: join(dataDir, "knowledge"),
    promptsDir: join(configDir, "prompts"),
    socketPath: join(runtimeDir, "sock"),
    pidPath: join(runtimeDir, "sociusd.pid"),
  };
}
