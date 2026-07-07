/**
 * The Permission contract. The LLM never touches the OS directly. Every tool
 * declares the capabilities it needs; the policy engine decides allow / confirm
 * / deny before execution, and reasoning is surfaced to the user first.
 */
import type { Result } from "./result.ts";

export type Capability =
  | "fs.read"
  | "fs.write"
  | "fs.delete"
  | "net"
  | "exec"
  | "secrets"
  | "email"
  | "calendar"
  | "clipboard";

export type Decision = "allow" | "confirm" | "deny";

/** How much a tool run is allowed to actually affect the world. */
export type ExecutionMode = "dry_run" | "sandbox" | "live";

export interface PermissionRequest {
  readonly toolName: string;
  readonly capabilities: readonly Capability[];
  /** Concrete resources touched (paths, hosts) for fine-grained policy + display. */
  readonly resources?: readonly string[];
  /** Human-readable reasoning shown before a confirm prompt. */
  readonly reasoning: string;
  readonly mode: ExecutionMode;
}

export interface PermissionOutcome {
  readonly decision: Decision;
  readonly reason: string;
}

export interface PolicyEngine {
  /** Pure evaluation against configured policy — no side effects, no prompting. */
  evaluate(req: PermissionRequest): PermissionOutcome;
}

/** Handles the interactive side of a `confirm` decision (CLI y/N, GUI dialog…). */
export interface ConfirmationProvider {
  confirm(req: PermissionRequest): Promise<Result<boolean>>;
}
