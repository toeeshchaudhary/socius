# Socius

> A local-first AI companion that lives in your terminal — an intelligent Unix citizen, not a chatbot.

Socius runs entirely on your machine. It reasons over piped input, **remembers** what you tell it,
reads your Markdown notes, **uses tools** (git, filesystem) under a real permission model, and
extends through **MCP servers** (local and remote). The LLM is just one replaceable component; the
product is the system around it — Memory, Planning, Execution, Permissions, Storage, Tooling.

```sh
git diff | socius "review this"
journalctl -p err -b | socius "what broke?"
socius "what's my git status?"          # ← calls git, summarizes
socius remember "I prefer TypeScript for tools"
socius "what do I prefer for tools?"    # ← recalls it
```

It feels like `grep`, not like ChatGPT: streaming, keyboard-first, composable, and **private**.

## Design principles

1. **You own every byte** — no account, no cloud, no telemetry. Notes are plain Markdown; state is one local SQLite file.
2. **Everything degrades gracefully** — if an integration fails, the rest keeps working.
3. **The LLM reasons; software executes** — the model never touches the OS directly: `LLM → Planner → Permission Layer → validated Tool → Execution`.
4. **Deterministic over probabilistic** — if code can compute it, code computes it.
5. **Everything is inspectable** — memory, logs, reasoning traces, config, prompts (`socius trace`).
6. **Everything is modular** — every subsystem sits behind a stable interface.

See [`docs/00-overview.md`](./docs/00-overview.md) for the full philosophy and
[`docs/`](./docs) for the complete architecture (module map, ADRs, subsystem designs).

## How it works

A thin `socius` CLI talks over a Unix socket to a lazy-spawned daemon (`sociusd`) that holds the
model resident and owns memory, planning, and tools. The planner is a **deterministic state graph**;
the LLM only fills narrow, schema-constrained slots (decide → plan → answer). MCP tools appear
identical to native ones.

```
socius (CLI) ──unix socket──► sociusd ──HTTP──► llama-server (model)
                                 │
                    memory (SQLite+vec+FTS) · knowledge (Markdown)
                    tools (git/fs) · MCP clients · permissions
```

Details: [`docs/01-architecture.md`](./docs/01-architecture.md),
[`docs/02-process-model.md`](./docs/02-process-model.md).

## Install

**Requirements:** [Bun](https://bun.sh) ≥ 1.3, a built [`llama.cpp`](https://github.com/ggml-org/llama.cpp)
(`llama-server`), and a GGUF chat model.

```sh
git clone https://github.com/toeeshchaudhary/socius.git
cd socius
bun install
./scripts/install.sh          # installs the `socius` command into ~/.local/bin
socius doctor                 # verify model, llama-server, paths
```

Then point config at your model (see [Configuration](#configuration)) and try it:

```sh
socius "say hello in one sentence"   # first call warms the model (~20-40s on CPU), then it's fast
```

Full instructions, tuning, and troubleshooting: [`docs/USAGE.md`](./docs/USAGE.md) and
[`docs/RUNBOOK.md`](./docs/RUNBOOK.md).

## Commands

| Command | What it does |
|---|---|
| `socius "<question>"` / `cmd \| socius "…"` | Ask / pipe-to-reason (streams the answer) |
| `socius remember "<text>"` | Save a long-term memory |
| `socius mem [list \| show <id> \| edit <id> <text> \| forget <id>]` | Inspect/edit memory (id = prefix) |
| `socius knowledge [index \| search <query>]` | Index/search your Markdown knowledge base |
| `socius morning` | A briefing (git + email/calendar if available) |
| `socius schedule [list \| run <name>]` | Background scheduled tasks |
| `socius trace [n] [--full]` | Replay the model's reasoning (each slot) |
| `socius serve` | Run Socius as an MCP server for other clients |
| `socius doctor` / `socius restart` | Status / restart the daemon |

The model calls tools automatically when relevant; **destructive** tools (`fs.write`, `git.commit`, …)
always prompt for confirmation first, showing their reasoning.

## Configuration

Everything is tunable in `~/.config/socius/config.toml` (hot-reloaded for safe sections). Copy
[`config.example.toml`](./config.example.toml) to get started. Highlights: model path & GPU layers,
permission policy, MCP servers (stdio **or** remote HTTP with header auth), and background schedules.
Secrets can come from the environment via `${VAR}` expansion. Reference: [`docs/10-config.md`](./docs/10-config.md).

## Features

- **Memory** — retrieval-first (embed → vector KNN + keyword hybrid → rerank → token budget), injected
  into answers. Inspectable and editable.
- **Knowledge base** — your Markdown notes, indexed and searchable; answers are grounded in them.
- **Tools + permissions** — native git/fs tools and MCP tools behind one interface, gated by a
  capability policy with interactive confirmation for anything destructive.
- **MCP** — connect any MCP server by config (local stdio or remote HTTP); or run **Socius as an MCP
  server** so other clients can query your second brain.
- **Scheduling** — run saved prompts on a timer with desktop notifications.
- **Observability** — structured logs + full reasoning traces; nothing hidden.

## Development

```sh
bun run typecheck    # tsc --build across the monorepo
bun test             # hermetic — no GPU/model/network needed
bun run lint         # biome
```

Contributing guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md). Architecture & decisions:
[`docs/`](./docs) (numbered docs + [`docs/adr/`](./docs/adr)).

## Status

Working local-first companion. Runs on modest hardware (developed against an RTX 3050 laptop, 4 GB
VRAM, CPU-only for the reference model). Pre-1.0 — interfaces may still change. Roadmap:
[`docs/17-roadmap.md`](./docs/17-roadmap.md).

## License

Built by [toeesh](https://github.com/toeeshchaudhary) · MIT licensed
