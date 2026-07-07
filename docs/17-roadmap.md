# 17 — Roadmap

Milestones are **vertical slices**, not horizontal layers. Each milestone leaves Socius usable —
we widen the system one working capability at a time rather than building all eight modules half-
way. The guiding constraint (from [`18-risks.md`](./18-risks.md)): *M1 must be usable before we
widen.*

## M0 — Foundation ✅ (this milestone)

Architecture doc set, Bun monorepo, `@socius/core` contracts, package stubs with real interfaces,
XDG paths, default config, logging, a working `DirectPlanner`, the LLM test-double pattern, CI.
`socius doctor` reports status. Typecheck clean, tests green.

## M1 — The spine: pipe-to-reason

`git diff | socius "review this"` works end-to-end.
- Hybrid daemon: socket server, handshake, lazy-spawn, idle-shutdown, pidfile, spawn-lock.
- `llama-server` child management: spawn with GPU flags, `/health` polling, auto-restart.
- llama.cpp inference adapter: streaming `/completion` (SSE) → IPC token notifications → stdout.
- Config load + zod validation; prompt templates on disk; reasoning-trace sink.
- `socius doctor` fully wired (model present? GPU? socket? config valid?).
- **No** memory/tools/planner-graph yet — those seams exist as stubs.
- *Exit:* warm second call is visibly faster; killing llama-server auto-restarts; idle-shutdown +
  respawn verified.

## M2 — Memory & knowledge

Socius starts to remember.
- SQLite + `sqlite-vec` + FTS5; migrations; single-writer.
- CPU embedder (second llama-server instance).
- Retrieval pipeline (embed → KNN → hybrid → rerank → budget); `socius mem` (list/show/edit/forget).
- Markdown knowledge base + file-watch indexing; `socius remember`, `socius knowledge search`.
- Config hot-reload for safe sections.

## M3 — Planner, tools, permissions

Socius starts to *act* — safely.
- Deterministic graph engine + node library (Classify, Plan, Confirm, ToolCall, Reflect).
- Native tools: `fs.read/list`, `git.diff/log/status`, `memory.search`, `knowledge.search`, and
  guarded `fs.write`.
- Capability policy engine wired end-to-end; dry-run / sandbox / confirm; reasoning-before-action.

## M4 — MCP

- MCP client over the official SDK; per-server spawn + tool wrapping + namespacing.
- Capability mapping for MCP tools; resilience (down server → tools dropped).
- First real integrations by config: Gmail, Calendar, Notion, filesystem.
- *Unlocks the morning workflow:* summarize mail + calendar + git + todos.

## M5 — GUI & voice (optional)

- React app (`apps/gui`) over the **same** daemon/IPC — no new brain, just another client.
- Optional voice input/output as an alternate CLI front-end.

## M6 — Long-running & proactive

- Background agents, scheduled workflows, smart notifications.
- Possibly Socius *as* an MCP server (expose memory/knowledge to other clients).

## Sequencing rationale

We prioritized **pipe-to-reason first** (per the design decision) because it proves the hardest
plumbing — the daemon lifecycle, IPC streaming, and model supervision — with the least surface
area, and is genuinely useful on day one. Memory and tools then hang on a proven spine. Building
the planner graph or MCP first would mean debugging behavior on top of unproven transport.
