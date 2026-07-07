/**
 * The shape of resolved configuration. The concrete loader/validator lives in
 * `@socius/config`; this is the type every other module reads against.
 *
 * Config is layered: built-in defaults ‹ config.toml ‹ environment ‹ CLI flags.
 */

export interface ModelConfig {
  /** Logical id, e.g. "gemma-3n-e4b-q4_k_m". Purely informational above inference. */
  readonly id: string;
  readonly path: string;
  readonly contextWindow: number;
  readonly gpuLayers: number;
}

export interface InferenceConfig {
  readonly llamaServerBin: string;
  readonly host: string;
  readonly port: number;
  readonly startupTimeoutMs: number;
  /**
   * Whether the model should emit chain-of-thought before answering. Default
   * false: reasoning models (like this Gemma build) otherwise spend the whole
   * token budget "thinking" and return empty content — and thinking is slow on
   * CPU, which fights the grep-like UX. The planner may enable it per-slot later.
   */
  readonly thinking: boolean;
  readonly embedder: {
    readonly id: string;
    readonly path: string;
    readonly port: number;
    /** Embeddings run on CPU to avoid VRAM contention with the chat model. */
    readonly cpuOnly: boolean;
  };
}

export interface DaemonConfig {
  readonly socketPath: string;
  readonly pidPath: string;
  readonly idleTimeoutMs: number;
}

export interface MemoryConfig {
  readonly defaultK: number;
  readonly defaultTokenBudget: number;
  readonly confidenceHalfLifeDays: number;
}

export interface PermissionsConfig {
  readonly defaultMode: "dry_run" | "sandbox" | "live";
  /** capability → default decision; per-tool overrides layered on top. */
  readonly policy: Readonly<Record<string, "allow" | "confirm" | "deny">>;
}

export interface LoggingConfig {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly dir: string;
  readonly traces: boolean;
}

export interface McpServerConfig {
  readonly name: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly enabled: boolean;
}

export interface StorageConfig {
  readonly dbFile: string;
  readonly knowledgeDir: string;
}

export interface SociusConfig {
  readonly model: ModelConfig;
  readonly inference: InferenceConfig;
  readonly daemon: DaemonConfig;
  readonly memory: MemoryConfig;
  readonly storage: StorageConfig;
  readonly permissions: PermissionsConfig;
  readonly logging: LoggingConfig;
  readonly mcp: readonly McpServerConfig[];
  readonly promptsDir: string;
}
