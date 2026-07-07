# 18 — Risks & Future Bottlenecks

An honest register of what can go wrong, why, and what we do about it. Reviewed each milestone.

## Technical risks

### R1 — The 4 GB VRAM ceiling (High / near-certain)
The reference GPU fits the model with little headroom; context is scarce and the model is weak.
- **Impact:** small context windows, slow-ish generation, limited reasoning depth.
- **Mitigations:** CPU embeddings (no VRAM contention); strict retrieval token budgets; KV-cache
  and quant options exposed in config; the `InferenceBackend` seam lets a user point at a bigger
  local or remote model with no rewrite ([`03-intelligence.md`](./03-intelligence.md)).
- **Bottleneck later:** as features want more context (long documents, multi-tool plans), context
  pressure grows. Answer is better retrieval and summarization, not a bigger prompt.

### R2 — Small-model planner reliability (High)
A 4B model is unreliable at autonomous multi-step reasoning.
- **Mitigations:** the entire deterministic-graph design ([`06-planner.md`](./06-planner.md));
  constrained decoding for slots; bounded recursion; eval tests gating prompt/model changes.
- **Residual:** classification and argument extraction can still err; the permission layer and
  dry-run are the safety net so an error is recoverable, not destructive.

### R3 — Daemon lifecycle bugs (Medium)
Spawn races, zombie children, stale sockets.
- **Mitigations:** flock spawn-lock, pidfile, handshake, health-checked child restart, integration
  tests over a temp socket, `socius doctor` to diagnose and `socius restart` to recover.

### R4 — Dependency / protocol churn (Medium)
MCP spec, model APIs, and the SDK evolve.
- **Mitigations:** adopt only narrow edges behind our own adapters (`McpToolAdapter`,
  `InferenceBackend`); version the IPC and plugin API ([`16-versioning.md`](./16-versioning.md))
  so drift fails loud.

### R5 — SQLite/vector scale (Low, long-horizon)
Years of memories and a large knowledge base could slow KNN.
- **Mitigations:** `sqlite-vec` handles single-user scale comfortably; retrieval is bounded;
  pruning/archival policies for low-confidence stale memory; the storage seam allows a swap to a
  dedicated vector index if ever justified (unlikely for one user).

## Product / process risks

### R6 — Over-architecture stall (High — the real project killer)
The greatest danger is polishing infrastructure while nothing is usable. A daily-driver that
isn't usable in month one dies before its architecture ever matters.
- **Mitigations:** milestones are vertical slices; M1 must ship a genuinely useful command before
  we widen; interfaces are designed broadly but implemented one slice at a time. This document is
  the reminder to *ship the spine*.

### R7 — Scope creep from the vision (Medium)
The vision (voice, GUI, background agents, multi-agent) is vast.
- **Mitigations:** the roadmap gates later planes behind a proven core; GUI/voice are *clients* of
  the same daemon, not new brains, so they cannot fork the architecture.

### R8 — Single-maintainer bus factor / open-source readiness (Medium)
The project assumes eventual contributors.
- **Mitigations:** this doc set, ADRs, strict module boundaries, hermetic tests (no GPU needed to
  contribute — [`14-testing.md`](./14-testing.md)), and a clear dev workflow lower the barrier to
  the first external PR.

## Security / privacy risks

### R9 — Destructive or exfiltrating tool actions (High impact, mitigated)
A tool (especially an MCP one) could delete data or send it somewhere.
- **Mitigations:** capability-based permissions, destructive-by-default confirmation, dry-run,
  sandbox, secrets denied by default, reasoning shown before action, and the hard invariant that
  nothing destructive runs unconfirmed ([`09-permissions.md`](./09-permissions.md)).

### R10 — Trace/log leakage (Low, mitigated)
Reasoning traces contain prompt content, possibly sensitive.
- **Mitigations:** sink-level redaction; traces are local-only and can be disabled; no telemetry
  ever.

## The one-line summary

The two risks that actually decide whether Socius exists in five years are **R6 (over-
architecture)** and **R2 (small-model reliability)**. The roadmap answers the first; the
deterministic planner answers the second. Everything else is engineering.
