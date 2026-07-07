# 17 — Roadmap

Milestones are **vertical slices**, not horizontal layers. Each milestone leaves Socius usable —
we widen the system one working capability at a time rather than building all eight modules half-
way. The guiding constraint (from [`18-risks.md`](./18-risks.md)): *M1 must be usable before we
widen.*

## M0 — Foundation ✅ (this milestone)

Architecture doc set, Bun monorepo, `@socius/core` contracts, package stubs with real interfaces,
XDG paths, default config, logging, a working `DirectPlanner`, the LLM test-double pattern, CI.
`socius doctor` reports status. Typecheck clean, tests green.

## M1 — The spine: pipe-to-reason ✅ (done, live-verified)

`git diff | socius "review this"` works end-to-end.
- Hybrid daemon: socket server, handshake, lazy-spawn, idle-shutdown, pidfile, spawn-lock.
- `llama-server` child management: spawn with GPU flags, `/health` polling, auto-restart.
- llama.cpp inference adapter: streaming `/completion` (SSE) → IPC token notifications → stdout.
- Config load + zod validation; prompt templates on disk; reasoning-trace sink.
- `socius doctor` fully wired (model present? GPU? socket? config valid?).
- **No** memory/tools/planner-graph yet — those seams exist as stubs.
- *Exit:* warm second call is visibly faster; killing llama-server auto-restarts; idle-shutdown +
  respawn verified.

## M2 — Memory & knowledge ✅ (done, live-verified)

Socius remembers.
- ✅ SQLite + `sqlite-vec` + FTS5; forward-only migrations; single-writer; dynamic
  vector dimension with rebuild-on-change.
- ✅ Retrieval pipeline (embed → vec KNN + FTS5 hybrid → rerank by similarity ×
  recency × confidence → token budget). Injected into the planner before answering.
- ✅ `HashingEmbedder` (model-free default, works out of the box) + `LlamaCppEmbedder`
  (real, for a configured embedding GGUF).
- ✅ Markdown knowledge base indexing (`indexKnowledge`), `socius remember`,
  `socius mem [list|forget]`, `socius knowledge [index|search]`.
- ⏳ Deferred to M2b: file-watch auto-reindex, config hot-reload, `mem edit`.

*Live-verified:* taught the daemon facts the base model cannot know (a codename; a
DB port from a Markdown note) and it answered correctly from retrieval.

> Gotcha found in M2: the shipped `gemma-4-E4B` is a **reasoning model** — left to
> think, it spends the whole token budget in `reasoning_content` and returns empty
> `content`. Socius disables thinking by default (`inference.thinking=false`).

## M3 — Planner, tools, permissions ✅ (done, live-verified)

Socius acts — safely.
- ✅ Deterministic `GraphPlanner`: retrieve memory → bounded decide→tool loop → answer. The LLM
  fills a grammar-constrained "decide" slot (JSON: answer | tool+args, verified against the real
  model) and the streaming "answer" slot. `maxToolCalls` bounds it — no open loops.
- ✅ Native tools: `fs.read`, `fs.list`, `fs.write` (destructive), `git.status/diff/log`.
- ✅ Capability policy engine + `ToolRunner` as the single choke point (evaluate → confirm →
  mode → invoke); dry-run / sandbox / live.
- ✅ **Interactive confirmation over IPC**: destructive tools block on the requesting client's
  approval (CLI prompts on /dev/tty); fail-closed on disconnect or no terminal.
- ⏳ Deferred to M3b: `Reflect`/self-correction node, richer git tools (commit/push), per-tool
  and per-path policy overrides from config.

*Live-verified:* "what's the git status?" → the model called `git.status` and summarized the
real diff; "list the files" → `fs.list`; "what is 2+2?" → answered directly (no tool). The
confirm round-trip (file written iff approved) is covered by hermetic tests.

## M4 — MCP ✅ (done, live-verified)

- ✅ MCP client over the official SDK (1.29); per-server stdio spawn, `listTools`,
  wrap each as a native `Tool` via `mcpToolToNative`, namespaced `server/tool`,
  registered into the same registry the planner uses (indistinguishable from native).
- ✅ Safety mapping: destructive-by-default unless `readOnlyHint`. Resilience: a
  server that fails to start is skipped; native tools keep working.
- ✅ `health()` / `socius doctor` report per-server MCP status; `config.example.toml`
  documents declaration.
- ⏳ Real integrations (Gmail/Calendar/Notion) are now **config-only** — add a
  `[[mcp]]` block. The morning-workflow *command* (summarize mail+calendar+git+todos)
  is a future convenience layer on top.

*Live-verified:* configured a local stdio MCP server; the model called its tool and
answered with a value only that server knew ("Falcon-Nine").

## M3b — polish ✅ (done, live-verified)

- ✅ Per-tool + per-path policy overrides (deny wins; trusted prefix downgrades
  confirm→allow; confirm tightens allow).
- ✅ `git.add` + `git.commit` (destructive). *Live:* the model chained add→commit,
  each requesting confirmation with its reasoning shown, and created a real commit.
- ✅ Reflect: on a tool failure the graph loops so `decide()` can self-correct;
  bounded by `maxToolCalls`.
- ✅ Fix: compact tool listing in the decide slot (full schemas overflowed context
  once large MCP tools were registered).

## M4b — remote MCP + config ✅ (done, live-verified)

- ✅ TOML config loader (`~/.config/socius/config.toml`), deep-merged over defaults,
  with `${ENV}` expansion for secrets.
- ✅ HTTP/SSE MCP transport (`StreamableHTTPClientTransport`) with header auth, in
  addition to stdio. *Live:* connected a remote Composio server (API-key header);
  the model called `COMPOSIO_SEARCH_TOOLS` over HTTP MCP and summarized the result.

## GUI — dropped

Socius is **CLI-only** by decision. No `apps/gui`. Additional front-ends, if ever, are
just clients of the same daemon/IPC — but none are planned.

## Polish batch ✅ (done)

- ✅ `mem show` / `mem edit`, and all `mem` subcommands resolve a unique id-prefix.
- ✅ Config hot-reload (daemon watches config.toml; live-applies policy/budgets, flags
  model/mcp changes as needing restart).
- ✅ Knowledge auto-reindex (daemon watches the knowledge dir; debounced reindex).
- ✅ Two-stage planner (decide → plan, args grammar-constrained per tool).
- ✅ Reasoning traces + `socius trace`.
- ✅ `socius morning` briefing command.

## M6 — Long-running & proactive ✅ (done)

- ✅ Scheduled background tasks: `[[schedules]]` with `everyMinutes` or `dailyAt`, run
  through the planner (no client → destructive tools fail safe), desktop notification
  via `notify-send`. `socius schedule [list|run <name>]`.
- ✅ Socius *as* an MCP server: `socius serve` exposes `search_memory`, `search_knowledge`,
  `remember` over stdio to any MCP client (e.g. Claude Desktop), proxied to the daemon.

## Still open (future)

- Cron-grade scheduling (multiple times/weekdays), notification actions.
- A retrieval/filter step before the decide slot when hundreds of tools are registered.
- Sandboxed execution mode (OS-level) as an extra layer under the permission model.

## Sequencing rationale

We prioritized **pipe-to-reason first** (per the design decision) because it proves the hardest
plumbing — the daemon lifecycle, IPC streaming, and model supervision — with the least surface
area, and is genuinely useful on day one. Memory and tools then hang on a proven spine. Building
the planner graph or MCP first would mean debugging behavior on top of unproven transport.
