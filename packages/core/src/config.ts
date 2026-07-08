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

/**
 * A remote OpenAI-compatible endpoint (gateway or direct provider). `gateway`
 * names a built-in preset (vercel, openrouter, groq, google, cerebras) that
 * supplies the baseUrl; "custom" uses `baseUrl` verbatim. The apiKey supports
 * `${VAR}` expansion so secrets can live in the environment.
 */
export interface RemoteInferenceConfig {
  readonly gateway: string;
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly contextWindow?: number;
}

export interface InferenceConfig {
  /** Which backend serves chat: a local llama-server or a remote gateway. */
  readonly backend: "local" | "remote";
  readonly remote?: RemoteInferenceConfig;
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

export type PolicyDecision = "allow" | "confirm" | "deny";

export interface PathRule {
  /** Path prefix this rule applies to (matched against a tool's resources). */
  readonly prefix: string;
  readonly decision: PolicyDecision;
}

export interface PermissionsConfig {
  readonly defaultMode: "dry_run" | "sandbox" | "live";
  /** capability → default decision. */
  readonly policy: Readonly<Record<string, PolicyDecision>>;
  /** Per-tool overrides (by tool name), win over the capability decision. */
  readonly tools?: Readonly<Record<string, PolicyDecision>>;
  /** Per-path rules for fs tools: `deny` always wins; `allow` can downgrade a
   *  confirm to allow (e.g. a trusted workspace); `confirm` tightens an allow. */
  readonly paths?: readonly PathRule[];
}

export interface LoggingConfig {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly dir: string;
  readonly traces: boolean;
}

/**
 * An MCP server, connected either over stdio (a local `command`) or over HTTP (a
 * remote `url` with optional `headers`, e.g. an API key). Exactly one transport
 * is used: `url` takes precedence if present, otherwise `command`.
 */
export interface McpServerConfig {
  readonly name: string;
  readonly enabled: boolean;
  // stdio transport
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  // http transport
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface StorageConfig {
  readonly dbFile: string;
  readonly knowledgeDir: string;
}

/**
 * A background task: run `prompt` on a schedule and (optionally) send a desktop
 * notification with the result. Provide either `everyMinutes` or `dailyAt`.
 */
export interface ScheduleConfig {
  readonly name: string;
  readonly prompt: string;
  readonly enabled: boolean;
  readonly everyMinutes?: number;
  /** Local time "HH:MM" for a once-a-day run. */
  readonly dailyAt?: string;
  /** Send a desktop notification with the result (default true). */
  readonly notify?: boolean;
}

export interface SociusConfig {
  readonly model: ModelConfig;
  readonly inference: InferenceConfig;
  /**
   * API keys by gateway name (`socius key set <gateway> <key>`). Used when
   * `inference.remote.apiKey` is not set; the gateway's conventional env var is
   * the final fallback.
   */
  readonly keys: Readonly<Record<string, string>>;
  readonly daemon: DaemonConfig;
  readonly memory: MemoryConfig;
  readonly storage: StorageConfig;
  readonly permissions: PermissionsConfig;
  readonly logging: LoggingConfig;
  readonly mcp: readonly McpServerConfig[];
  readonly schedules: readonly ScheduleConfig[];
  readonly promptsDir: string;
}
