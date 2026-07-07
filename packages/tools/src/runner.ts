/**
 * The ToolRunner is the single choke point through which every tool call passes.
 * It enforces the permission pipeline (Principle #3): evaluate policy → confirm
 * if required → honor the execution mode → invoke. Nothing bypasses it.
 */
import type {
  ConfirmationProvider,
  ExecutionMode,
  PermissionRequest,
  PolicyEngine,
  Result,
  Tool,
  ToolContext,
  ToolResult,
} from "@socius/core";
import { error, ok } from "@socius/core";

export interface RunOptions {
  readonly mode: ExecutionMode;
  /** Human-readable justification, shown before a confirm prompt. */
  readonly reasoning: string;
  readonly resources?: readonly string[];
  readonly ctx: ToolContext;
}

export class ToolRunner {
  constructor(
    private readonly policy: PolicyEngine,
    private readonly confirmer?: ConfirmationProvider,
  ) {}

  async run(tool: Tool, args: unknown, opts: RunOptions): Promise<Result<ToolResult>> {
    const req: PermissionRequest = {
      toolName: tool.name,
      capabilities: tool.capabilities,
      reasoning: opts.reasoning,
      mode: opts.mode,
      ...(opts.resources ? { resources: opts.resources } : {}),
    };

    const outcome = this.policy.evaluate(req);
    if (outcome.decision === "deny") {
      return { ok: false, error: error("PERMISSION_DENIED", "permissions", outcome.reason) };
    }

    const needsConfirm =
      outcome.decision === "confirm" || (tool.destructive && opts.mode === "live");
    if (needsConfirm) {
      if (!this.confirmer) {
        return {
          ok: false,
          error: error(
            "CONFIRMATION_REQUIRED",
            "permissions",
            `confirmation required to run ${tool.name}`,
          ),
        };
      }
      const answered = await this.confirmer.confirm(req);
      if (!answered.ok) return answered;
      if (!answered.value) {
        return { ok: false, error: error("PERMISSION_DENIED", "permissions", "declined by user") };
      }
    }

    if (opts.mode === "dry_run") {
      return ok({
        data: { dryRun: true, tool: tool.name, args },
        summary: `[dry-run] would run ${tool.name}`,
      });
    }

    return tool.invoke(args, opts.ctx);
  }
}
