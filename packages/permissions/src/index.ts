/**
 * @socius/permissions — capability-based policy engine (M3). Pure evaluation of
 * a PermissionRequest against configured policy; the interactive confirm side is
 * a separate provider so the engine stays side-effect-free and testable.
 *
 * Precedence (safest wins): a `deny` from any source is final. Per-tool overrides
 * replace the per-capability decision. Per-path rules can tighten (→ confirm) or,
 * for a trusted prefix, loosen (confirm → allow).
 */
import type {
  Capability,
  Decision,
  PermissionOutcome,
  PermissionRequest,
  PolicyEngine,
} from "@socius/core";

export type PolicyMap = Readonly<Record<string, Decision>>;

export interface PathRule {
  readonly prefix: string;
  readonly decision: Decision;
}

export interface PolicyOverrides {
  readonly tools?: Readonly<Record<string, Decision>>;
  readonly paths?: readonly PathRule[];
}

const RANK: Record<Decision, number> = { allow: 0, confirm: 1, deny: 2 };
const worst = (a: Decision, b: Decision): Decision => (RANK[a] >= RANK[b] ? a : b);

export class ConfiguredPolicyEngine implements PolicyEngine {
  constructor(
    private readonly policy: PolicyMap,
    private readonly overrides: PolicyOverrides = {},
  ) {}

  evaluate(req: PermissionRequest): PermissionOutcome {
    // 1. Capability baseline: safest across all required capabilities.
    let base: Decision = "allow";
    for (const cap of req.capabilities) {
      const d = this.decisionFor(cap);
      if (d === "deny")
        return { decision: "deny", reason: `capability '${cap}' is denied by policy` };
      base = worst(base, d);
    }

    // 2. Per-tool override replaces the capability decision.
    const toolOverride = this.overrides.tools?.[req.toolName];
    if (toolOverride === "deny")
      return { decision: "deny", reason: `tool '${req.toolName}' is denied by policy` };
    if (toolOverride) base = toolOverride;

    // 3. Per-path rules against the touched resources.
    const pathVerdict = this.evaluatePaths(req.resources ?? []);
    if (pathVerdict === "deny")
      return { decision: "deny", reason: "a targeted path is denied by policy" };
    if (pathVerdict === "confirm") base = worst(base, "confirm");
    if (pathVerdict === "allow" && base === "confirm") base = "allow";

    // 4. dry-run has no side effects — always safe.
    if (req.mode === "dry_run") return { decision: "allow", reason: "dry-run: no side effects" };

    return {
      decision: base,
      reason:
        base === "allow"
          ? "permitted by policy"
          : base === "deny"
            ? "denied by policy"
            : "confirmation required",
    };
  }

  /** Returns the strongest matching path decision, or null if no rule matched. */
  private evaluatePaths(resources: readonly string[]): Decision | null {
    const rules = this.overrides.paths;
    if (!rules || rules.length === 0 || resources.length === 0) return null;
    let verdict: Decision | null = null;
    for (const resource of resources) {
      // most specific (longest prefix) matching rule for this resource
      let match: PathRule | null = null;
      for (const rule of rules) {
        if (
          resource.startsWith(rule.prefix) &&
          (!match || rule.prefix.length > match.prefix.length)
        )
          match = rule;
      }
      if (match) verdict = verdict ? worst(verdict, match.decision) : match.decision;
    }
    return verdict;
  }

  private decisionFor(cap: Capability): Decision {
    return this.policy[cap] ?? "confirm";
  }
}
