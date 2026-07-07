/**
 * A single error taxonomy shared across every module. Each error carries a
 * stable `code` (for programmatic handling and `socius doctor`), a
 * human-readable `message`, the `subsystem` it originated in (so degradation
 * can be reported per-module), and an optional `cause`.
 */

export type Subsystem =
  | "config"
  | "storage"
  | "inference"
  | "memory"
  | "knowledge"
  | "planner"
  | "tools"
  | "mcp"
  | "permissions"
  | "daemon"
  | "cli"
  | "ipc";

export type ErrorCode =
  | "CONFIG_INVALID"
  | "BACKEND_UNAVAILABLE"
  | "BACKEND_TIMEOUT"
  | "MODEL_LOAD_FAILED"
  | "CONTEXT_OVERFLOW"
  | "STORAGE_FAILED"
  | "MIGRATION_FAILED"
  | "TOOL_NOT_FOUND"
  | "TOOL_INPUT_INVALID"
  | "TOOL_FAILED"
  | "PERMISSION_DENIED"
  | "CONFIRMATION_REQUIRED"
  | "SLOT_OUTPUT_INVALID"
  | "PLAN_BUDGET_EXCEEDED"
  | "MCP_HANDSHAKE_FAILED"
  | "IPC_PROTOCOL_MISMATCH"
  | "IPC_TRANSPORT_FAILED"
  | "DAEMON_UNREACHABLE"
  | "NOT_IMPLEMENTED"
  | "INTERNAL";

export class SociusError extends Error {
  readonly code: ErrorCode;
  readonly subsystem: Subsystem;
  /** True when the failure is expected and recoverable (degrade, don't crash). */
  readonly recoverable: boolean;

  constructor(
    code: ErrorCode,
    subsystem: Subsystem,
    message: string,
    options?: { cause?: unknown; recoverable?: boolean },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "SociusError";
    this.code = code;
    this.subsystem = subsystem;
    this.recoverable = options?.recoverable ?? true;
  }
}

export const error = (
  code: ErrorCode,
  subsystem: Subsystem,
  message: string,
  options?: { cause?: unknown; recoverable?: boolean },
): SociusError => new SociusError(code, subsystem, message, options);
