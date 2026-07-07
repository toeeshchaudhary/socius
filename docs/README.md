# Socius Architecture Documentation

This is the design record for Socius. It is written to be read by a future contributor (or a
future version of ourselves) with no prior context. Every hard decision has an ADR under
[`adr/`](./adr) using the template: **Why / Alternatives considered / Tradeoffs / Long-term
implications / Why alternatives were rejected.**

## Reading order

| # | Document | What it covers |
|---|----------|----------------|
| 00 | [Overview](./00-overview.md) | Vision, the six principles, what Socius is and isn't |
| 01 | [Architecture](./01-architecture.md) | Module map, dependency graph, data flow |
| 02 | [Process model](./02-process-model.md) | Daemon + CLI, lazy-spawn, IPC protocol |
| 03 | [Intelligence](./03-intelligence.md) | Inference backend abstraction, llama.cpp, embeddings |
| 04 | [Memory](./04-memory.md) | Memory types, schema, retrieval pipeline |
| 05 | [Knowledge](./05-knowledge.md) | The Markdown knowledge base |
| 06 | [Planner](./06-planner.md) | The deterministic state-graph planner |
| 07 | [Tools](./07-tools.md) | The unified tool interface |
| 08 | [MCP](./08-mcp.md) | Socius as an MCP client |
| 09 | [Permissions](./09-permissions.md) | Capabilities, policy, sandbox, confirmation |
| 10 | [Configuration](./10-config.md) | TOML schema, XDG layout, precedence |
| 11 | [Storage](./11-storage.md) | SQLite layout, migrations, backup |
| 12 | [Logging & observability](./12-logging-observ.md) | Structured logs, reasoning traces |
| 13 | [Errors & resilience](./13-errors-resilience.md) | Graceful degradation matrix |
| 14 | [Testing](./14-testing.md) | Unit / contract / eval strategy |
| 15 | [Dev workflow](./15-dev-workflow.md) | Monorepo, scripts, contribution guide |
| 16 | [Versioning](./16-versioning.md) | SemVer across code, config, protocol, plugins |
| 17 | [Roadmap](./17-roadmap.md) | Milestones M0–M6 |
| 18 | [Risks](./18-risks.md) | Risk register and future bottlenecks |

## The one-paragraph version

Socius is a local-first AI companion that lives in your terminal. A thin `socius` CLI talks
over a Unix socket to a lazy-spawned daemon (`sociusd`) that holds a small local model resident
via llama.cpp and owns memory, planning, tools, and permissions. The LLM only *reasons*;
deterministic TypeScript *executes*. Your data lives in plain Markdown and a single SQLite file
that you own. Every subsystem sits behind a stable interface and is independently replaceable.
