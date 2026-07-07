/**
 * @socius/permissions — capability-based policy engine (M3). Pure evaluation of
 * a PermissionRequest against configured policy; the interactive confirm side is
 * a separate provider so the engine stays side-effect-free and testable.
 */
import type {
  Capability,
  Decision,
  PermissionOutcome,
  PermissionRequest,
  PolicyEngine,
} from "@socius/core";

export type PolicyMap = Readonly<Record<string, Decision>>;

export class ConfiguredPolicyEngine implements PolicyEngine {
  constructor(private readonly policy: PolicyMap) {}

  evaluate(req: PermissionRequest): PermissionOutcome {
    // Deny wins, then confirm, then allow — the safest decision across all
    // required capabilities is the one that governs the whole request.
    let decision: Decision = "allow";
    for (const cap of req.capabilities) {
      const d = this.decisionFor(cap);
      if (d === "deny") return { decision: "deny", reason: `capability '${cap}' is denied by policy` };
      if (d === "confirm") decision = "confirm";
    }
    if (req.mode === "dry_run") return { decision: "allow", reason: "dry-run: no side effects" };
    return { decision, reason: decision === "allow" ? "permitted by policy" : "confirmation required" };
  }

  private decisionFor(cap: Capability): Decision {
    return this.policy[cap] ?? "confirm";
  }
}
