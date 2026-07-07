# ADR-0001 — Hybrid lazy-spawned daemon + thin CLI over a Unix socket

Status: Accepted
Date: 2026-07-07

## Context
Socius must feel like `grep` — instant response to `git diff | socius "…"`. But the reasoning
model is ~3 GB of weights that take 3–8 s to load into VRAM. Something must hold the model
resident between commands, and the interface a user types into must start instantly.

## Decision
A long-running daemon (`sociusd`) holds the model resident and owns all stateful subsystems. A
thin `socius` CLI does I/O only and, on each invocation, connects to the daemon's Unix domain
socket — **lazy-spawning the daemon if it is not running**, then streaming. The daemon
idle-shuts-down after a configurable TTL; an optional systemd user unit can keep it always-on.
Transport is newline-delimited JSON-RPC 2.0, versioned in the handshake.

## Alternatives considered
1. **Ephemeral CLI, no daemon** (rely on a separate persistent `llama-server` only).
2. **Always-on daemon** (never idle-shutdown).
3. **localhost TCP/HTTP or gRPC** instead of a Unix socket.

## Tradeoffs
Accepted: lifecycle complexity — spawn races (flock), handshake, crash recovery, idle timing.
Gained: warm-model latency when working, zero resource cost when idle, no manual "start server."

## Long-term implications
The daemon is the single writer to SQLite (no multi-writer contention) and the single owner of
model children. GUI/voice become *clients* of the same socket, not new architectures. The
protocol version guards against CLI/daemon drift once installed system-wide.

## Why the alternatives were rejected
1. Ephemeral would reload 3 GB per command (kills grep-feel) and keep Socius's own caches cold.
   A bare `llama-server` also can't own memory/planner/permissions.
2. Always-on wastes VRAM/RAM on an idle laptop; offered as opt-in, not default.
3. A Unix socket gives free, correct access control via file permissions (0600, user-owned), no
   port to secure, and trivial local inspection. TCP opens a network surface for a data-holding
   companion; gRPC adds codegen for a two-process local link — both unjustified.
