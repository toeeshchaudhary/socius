# Architecture Decision Records

Each ADR captures one hard decision using a fixed template so the *reasoning* survives, not just
the outcome. New ADRs are numbered sequentially and are immutable once `Accepted` — a reversal is
a new ADR that supersedes the old one.

## Template

```
# ADR-NNNN — Title
Status: Proposed | Accepted | Superseded by ADR-XXXX
Date: YYYY-MM-DD

## Context        — the forces at play
## Decision       — what we chose
## Alternatives considered
## Tradeoffs
## Long-term implications
## Why the alternatives were rejected
```

## Index

| ADR | Decision |
|-----|----------|
| [0001](./0001-hybrid-daemon.md) | Hybrid lazy-spawned daemon + thin CLI over a Unix socket |
| [0002](./0002-inference-backend.md) | Model behind an `InferenceBackend` interface; CPU embeddings |
| [0003](./0003-memory-retrieval.md) | Retrieval-first memory, not context-stuffing |
| [0004](./0004-deterministic-planner.md) | Deterministic state-graph planner, LLM-in-slots |
| [0005](./0005-unified-tools.md) | One `Tool` interface for native and MCP tools |
| [0006](./0006-capability-permissions.md) | Capability-based permission model |
| [0007](./0007-monorepo-bun-ts.md) | Bun + TypeScript monorepo |
| [0008](./0008-storage-config-formats.md) | SQLite for state, TOML for config, Markdown for knowledge |
