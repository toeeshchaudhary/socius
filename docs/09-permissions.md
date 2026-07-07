# 09 — Permissions & Safety

> Canonical decision: [ADR-0006](./adr/0006-capability-permissions.md).

Principle #3 says the LLM reasons and software executes — the model never touches the OS
directly. The permission layer is where that principle is enforced. Every effect on the world
passes through it: `LLM → Planner → Permission Layer → validated Tool → Execution`.

Interfaces: `packages/core/src/permissions.ts`. Reference engine:
`packages/permissions/src/index.ts`.

## Capabilities

Every tool declares the capabilities it needs. Capabilities are coarse, auditable, and few:

```
fs.read  fs.write  fs.delete  net  exec  secrets  email  calendar  clipboard
```

A tool cannot do anything it did not declare — capability declaration *is* the contract the
permission layer polices.

## The policy engine

The engine is a **pure function**: a `PermissionRequest` in, a `PermissionOutcome`
(`allow` / `confirm` / `deny`) out. No side effects, no prompting — which makes it exhaustively
unit-testable (see `packages/permissions/src/policy.test.ts`).

Policy is configured per-capability with per-tool and per-path overrides
([`10-config.md`](./10-config.md)). The default posture is conservative:

```toml
[permissions.policy]
"fs.read"  = "allow"
"fs.write" = "confirm"
"fs.delete"= "confirm"
net        = "confirm"
exec       = "confirm"
secrets    = "deny"
```

**Resolution rules (deterministic):**
- The **safest** decision across all required capabilities governs the whole request:
  `deny` beats `confirm` beats `allow`. A tool needing both `fs.read` (allow) and `secrets`
  (deny) is denied.
- An **unknown** capability defaults to `confirm`, never `allow`. New capabilities are safe by
  construction.
- **Destructive** tools require confirmation regardless of capability policy, unless explicitly
  allowed by a per-tool override.

## Execution modes

Orthogonal to allow/confirm/deny, a request runs in one of three modes:

- **`dry_run`** — the tool describes what it *would* do and makes no change. Always permitted
  (nothing happens), so it is the safe way to preview a plan.
- **`sandbox`** — the tool runs with restricted filesystem/network access (e.g. a temp
  workdir, no outbound net). For "try it, but contained."
- **`live`** — real effects. The default, gated by policy above.

## Reasoning before action

Before any `confirm`, the user sees the tool, the concrete resources it will touch (paths,
hosts), and a **human-readable reason** the planner generated for *why* it wants to run. The
confirmation prompt is not "Allow tool X? [y/N]" in a vacuum — it is:

```
Socius wants to run: git.commit
  reason : you asked me to save the daemon work; staging 6 files
  writes : .git/  (repository at ~/Documents/socius)
  [y] run   [n] skip   [d] dry-run first   [!] always allow git.commit
Proceed? _
```

The `ConfirmationProvider` interface abstracts the interaction so the CLI (y/N on a TTY) and a
future GUI (a dialog) satisfy the same contract.

## Never auto-destruct

There is no code path in which a destructive operation runs without an explicit `allow` policy
or an interactive confirmation. "Delete all my logs" produces a preview and a prompt, not a
deletion. This is a hard invariant, tested at the policy layer and enforced again at the tool
boundary.

## Why capability-based, not a trusted-tools allowlist (ADR-0006)

- **Why:** capabilities describe *what a tool can do*, which composes with a small policy and
  scales to hundreds of tools (including unknown MCP tools) without hand-auditing each one. A new
  MCP tool that declares `fs.write` is automatically subject to the write policy.
- **Alternatives:** a per-tool trust allowlist; running everything in an OS sandbox and asking
  nothing; full autonomy with an undo log.
- **Tradeoffs:** capabilities are only as honest as a tool's declaration. Native tools we
  control; MCP tools we treat as declaring the union of what their schema implies, and default
  unknowns to `confirm`. An OS sandbox is a valuable *additional* layer (the `sandbox` mode) but
  not a substitute for intent-level policy.
- **Rejected the allowlist** because it does not scale to dynamically discovered MCP tools;
  **rejected full-autonomy-with-undo** because "undo" is a lie for sent emails, pushed commits,
  and deleted remote data — prevention must come before the fact, not after.
