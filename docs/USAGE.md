# Usage Guide

A practical reference for the `socius` command. For the *why* behind the design, see the numbered
architecture docs in this folder; for driving the live model in detail, see
[`RUNBOOK.md`](./RUNBOOK.md).

## Install

```sh
bun install
./scripts/install.sh     # creates ~/.local/bin/socius
socius doctor
```

`install.sh` writes a tiny wrapper that runs the CLI from the repo via Bun — no build step. Keep the
repo where it is (the wrapper points at it).

## First run

The daemon (`sociusd`) is spawned automatically on first use and holds the model resident. The
**first call is slow** — it loads the model (CPU: ~20–40 s for the reference model) and connects any
MCP servers. Every call after that is warm and fast. The daemon idle-shuts-down after 30 minutes and
respawns transparently.

```sh
socius "say hello in one sentence"
```

## Asking & piping

The core interaction. Output streams to stdout and is pipe-clean (diagnostics go to stderr).

```sh
socius "explain what a segfault is"
git diff | socius "review this"
journalctl -p err -b | socius "what broke?"
cat build.log | socius "summarize the errors"
socius "what does this script do" < deploy.sh
```

If the request needs information the model doesn't have, it calls a **tool** automatically (see
below). Complex output can be capped with the daemon default; long generations stream as they go.

## Memory

Socius remembers across sessions. Memory is **retrieved** per query (semantic + keyword) and injected
into answers — not dumped wholesale.

```sh
socius remember "I prefer TypeScript over Python for tools"
socius remember "The prod DB for project X is on port 6789"

socius mem                       # list recent memories (id shown as an 8-char prefix)
socius mem show 3a1f9c2b         # full detail of one memory
socius mem edit 3a1f9c2b "updated content"
socius mem forget 3a1f9c2b       # any unique id-prefix works

socius "what do I prefer for writing tools?"   # ← recalls the memory
```

## Knowledge base

Your Markdown notes under `~/.local/share/socius/knowledge/{projects,journal,notes,todos,architecture,
meetings,ideas,experiments}`. Files are canonical; Socius keeps a derived, searchable index.

```sh
# add notes as plain .md files, then:
socius knowledge index                     # (re)build the index (auto-reindexes on change too)
socius knowledge search "database migration"
socius "what did I decide about the renderer?"   # ← grounded in your notes
```

## Tools & safety

The model uses tools when a request needs them. Read-only tools run automatically; **destructive**
tools always prompt.

- Read-only: `fs.read`, `fs.list`, `git.status`, `git.diff`, `git.log`
- Destructive (prompt for confirmation): `fs.write`, `git.add`, `git.commit`

```sh
cd ~/some/repo
socius "what's my git status?"                 # git.status → summary
socius "list the files here and count them"    # fs.list
socius "stage my changes and commit with a good message"
#   ↳ Socius wants to run: git.commit — <its reasoning>   [y] run  [N] skip
```

Nothing destructive runs without your `y`. In a non-interactive context (piped, no terminal), such
tools are denied by default. Policy is configurable per-capability, per-tool, and per-path
(see [Configuration](#configuration)).

## MCP servers (extending Socius)

Add any [MCP](https://modelcontextprotocol.io) server in config and its tools appear alongside native
ones — the planner can't tell them apart. Both transports are supported:

```toml
# local (stdio)
[[mcp]]
name = "filesystem"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/home/you/Documents"]
enabled = true

# remote (HTTP + header auth)
[[mcp]]
name = "composio"
url = "https://connect.composio.dev/mcp"
enabled = true
headers = { "x-consumer-api-key" = "${COMPOSIO_API_KEY}" }
```

`socius doctor` shows connected MCP servers and tool counts. A server that fails to start is skipped —
native tools keep working.

### Socius as an MCP server

Expose your Socius memory/knowledge to *other* MCP clients (e.g. Claude Desktop):

```sh
socius serve      # runs an MCP server over stdio
```

Add to the client's config:

```json
{ "mcpServers": { "socius": { "command": "socius", "args": ["serve"] } } }
```

It exposes `search_memory`, `search_knowledge`, and `remember`, proxied to your daemon.

## Scheduled tasks & briefings

```sh
socius morning                   # a briefing: git activity + email/calendar if available
socius schedule list             # configured background tasks
socius schedule run standup      # run one now
```

Define background tasks in config; each runs on a timer and (by default) sends a desktop notification:

```toml
[[schedules]]
name = "morning"
prompt = "Summarize today's emails, calendar, and uncommitted git changes. Short bullets."
dailyAt = "08:00"        # or: everyMinutes = 240
enabled = true
notify = true
```

## Inspecting reasoning

Everything the model saw and decided is recorded.

```sh
socius trace            # last 10 reasoning slots (decide / plan:<tool> / answer)
socius trace 20 --full  # more, untruncated
```

Traces live at `~/.local/state/socius/traces.jsonl` (credentials redacted). Disable with
`logging.traces = false`.

## Managing the daemon

```sh
socius doctor      # model, llama-server, daemon, tools, MCP status
socius restart     # stop the daemon (respawns on next use) — run after editing config
```

## Configuration

All settings live in `~/.config/socius/config.toml`, deep-merged over built-in defaults, with
`${VAR}` environment expansion for secrets. Copy [`../config.example.toml`](../config.example.toml).
Safe sections (permission policy, budgets) hot-reload; model/port/MCP changes need `socius restart`.

Key sections: `[model]` (path, `gpuLayers`, `contextWindow`), `[inference]` (`backend`,
`thinking`, `[inference.remote]`), `[permissions]` (+ `[permissions.policy]`, `permissions.tools`,
`permissions.paths`), `[[mcp]]`, `[[schedules]]`. Full reference: [`10-config.md`](./10-config.md).

### Configuring from the CLI

Every setting can also be managed without touching TOML:

```sh
socius config list                          # effective config (secrets redacted)
socius config get memory.defaultTokenBudget
socius config set memory.defaultTokenBudget 2048
socius config unset memory.defaultTokenBudget   # fall back to config.toml/default
```

CLI-set values are stored in `~/.config/socius/config.cli.toml`, layered **over** `config.toml` —
your hand-written file (and its comments) is never rewritten. Values parse as JSON where possible
(`true`, `2048`, `["a","b"]`), otherwise as strings; `${VAR}` expansion applies at load time.

### Local vs remote models

Chat can run on the local llama-server or any OpenAI-compatible gateway (Vercel AI Gateway,
OpenRouter, Groq, Google AI Studio, Cerebras, or a custom baseUrl). Memory, tools, permissions,
and MCP work identically either way.

```sh
socius model                                # show the active backend/model
socius model list                           # gateway presets + free-tier notes
socius model use openrouter meta-llama/llama-3.3-70b-instruct:free
socius model use vercel anthropic/claude-haiku-4.5
socius model local                          # back to the local GGUF
```

Switching restarts the daemon automatically.

### Gateway API keys

```sh
socius key set openrouter sk-or-v1-...      # live-checks the key, then stores it (chmod 600)
socius key list                             # which gateways have keys (stored / from env / not set)
socius key remove openrouter
```

`key set` verifies the key against the gateway before saving: a rejected key (401/403) is not
stored (`--force` overrides); if the gateway can't be reached the key is saved unverified with a
warning.

The daemon resolves a gateway's key in order: `inference.remote.apiKey` (config.toml, supports
`${VAR}`) → the stored key (`socius key set`) → the gateway's conventional env var (e.g.
`OPENROUTER_API_KEY`). So either store the key once with `socius key set`, or just export the env
var — both work with no further config. `socius model use <gateway> <model> <key>` also saves the
key to the store as a shortcut.

### Performance note (reference model)

The bundled reference model (`gemma-4-E4B`, ~5 GB) exceeds a 4 GB GPU, and partial offload of its
architecture crashes llama.cpp — so it runs **CPU-only** (`gpuLayers = 0`). For GPU speed, use a
model/quant that fits your VRAM and raise `gpuLayers`. The backend is an interface: pointing at a
larger local model or a remote OpenAI-compatible endpoint is a config change, no code.

## Data & privacy

- Knowledge: `~/.local/share/socius/knowledge/**.md` (plain Markdown — survives Socius's removal).
- State: `~/.local/share/socius/socius.db` (SQLite — memory, embeddings, FTS).
- Logs/traces: `~/.local/state/socius/`.
- Config/prompts: `~/.config/socius/`.

No account, no cloud, no telemetry. Back up by copying the DB file and the knowledge folder.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `doctor` shows model/llama-server missing | Set `model.path` / `inference.llamaServerBin` in config |
| First call hangs a long time | Cold model load on CPU is slow; wait, or use a smaller model |
| Empty answers | Reasoning model over-thinking — ensure `inference.thinking = false` (default) |
| Destructive tool won't run when piped | By design — no TTY means no confirmation; run interactively |
| Stuck daemon / model | `pkill -f llama-server; socius restart` |
| MCP server down | `socius doctor` shows the error; check `command`/`url`/`headers` |
