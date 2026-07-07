# ADR-0006 — Capability-based permission model

Status: Accepted
Date: 2026-07-07

## Context
Principle #3: the LLM never touches the OS directly; every effect passes through a permission
layer. Tools include dynamically discovered MCP tools we do not author, so per-tool hand-auditing
does not scale. Destructive operations must never run unconfirmed.

## Decision
Each tool declares coarse capabilities (`fs.read`, `fs.write`, `fs.delete`, `net`, `exec`,
`secrets`, …). A pure policy engine maps capabilities → `allow`/`confirm`/`deny` (config-driven,
with per-tool and per-path overrides). The safest decision across required capabilities governs;
unknown capabilities default to `confirm`; destructive tools require confirmation unless
explicitly allowed. Orthogonal execution modes: `dry_run`, `sandbox`, `live`. Reasoning is shown
before any confirm.

## Alternatives considered
1. A per-tool trust allowlist.
2. Run everything in an OS sandbox and ask nothing.
3. Full autonomy with an undo log.

## Tradeoffs
Capabilities are only as honest as a tool's declaration; for MCP we infer from schema and default
unknowns to confirm. The policy engine being pure makes it exhaustively testable. Gained: scales
to hundreds of unknown tools with one small policy.

## Long-term implications
New MCP tools are automatically governed. OS sandboxing remains a valuable *additional* layer
(the `sandbox` mode), not a replacement for intent-level policy.

## Why the alternatives were rejected
1. An allowlist can't scale to dynamically discovered tools and needs manual auditing per tool.
2. A pure sandbox answers "can it reach X" but not "should it, given intent" — and can't prevent a
   legitimately-permitted-but-unwanted action.
3. "Undo" is a lie for sent email, pushed commits, and deleted remote data — prevention must
   precede the action.
