# 13 — Errors & Resilience

Principle #2 is a promise: no single failure takes down the whole companion. This document is the
explicit contract for how Socius degrades. Reference: `packages/core/src/errors.ts`,
`packages/core/src/result.ts`.

## Errors are values, not surprises

Expected failures — a denied tool, an unhealthy backend, an invalid config, a missing MCP server
— are returned as `Result<T, SociusError>`, not thrown. Every `SociusError` carries a stable
`code`, the `subsystem` it came from, and a `recoverable` flag. Throwing is reserved for
programmer bugs. This forces callers to *handle* degradation at the type level instead of letting
an exception cross a module boundary and crash the daemon.

## The degradation matrix

| If this fails… | …these keep working | Behavior |
|----------------|---------------------|----------|
| Reasoning model (llama-server) crashes | memory, knowledge, tools, all files | daemon restarts the child; meanwhile read-only ops (`socius mem list`, `knowledge search`) work; inference calls return `BACKEND_UNAVAILABLE` |
| Embedder crashes | chat, keyword search, files | memory retrieval falls back to FTS5 keyword-only; writes queue for re-embedding |
| SQLite unavailable/corrupt | chat, knowledge files on disk | structured memory degrades; Markdown is still readable/greppable; `doctor` flags it; reindex rebuilds derived tables |
| An MCP server is down | native tools, everything else | its tools drop from the registry; planner plans without them |
| Gmail/Calendar tool fails | filesystem, git, memory, notes | that tool returns an error; the rest of the morning workflow proceeds |
| Config invalid | (nothing starts) | fail fast with `CONFIG_INVALID` and the exact key; never run on a broken config |
| Daemon dies | your data (all on disk) | CLI detects the dead socket and respawns; no data loss — state is on disk, not in RAM |

The through-line: **canonical data lives on disk and outlives every process**, and each subsystem
sits behind an interface so its failure is contained to a `Result`, not a cascade.

## Failure isolation by construction

- **Model runtime is out-of-process** ([`03-intelligence.md`](./03-intelligence.md)): a CUDA
  segfault is a child exit the daemon supervises, not a daemon crash.
- **MCP servers are separate processes**: a hung server is killed and dropped, not awaited
  forever.
- **The daemon is the single writer** to SQLite: no corruption from concurrent writers.

## Retries and timeouts

- Backend calls have timeouts (`BACKEND_TIMEOUT`); the planner degrades rather than hanging.
- Child processes (llama-server, MCP) are health-checked; a crashed child is restarted with
  backoff, and repeated failures are surfaced via `doctor` instead of silent retry storms.
- Slot outputs that fail schema validation retry once, then the graph handles
  `SLOT_OUTPUT_INVALID` — usually by degrading to a plain answer.

## The invariant

There is no failure mode in which Socius **loses your data** or **performs a destructive action
you did not confirm**. Everything else is allowed to degrade to "that feature is temporarily
unavailable," reported honestly by `doctor`. A companion you trust for a decade must fail small
and fail loud, never silently and never catastrophically.
