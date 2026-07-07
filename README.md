# Socius

> A local-first AI operating companion for the terminal. An intelligent Unix citizen — not a chatbot.

Socius runs on your machine, owns your data, and lives in your terminal. The LLM is just one
replaceable component; the product is the system around it — **Intelligence, Memory, Planning,
Execution, Permissions, UI, Storage, and Tooling**, each an independently replaceable module.

```sh
git diff | socius "review this"
journalctl -p err -b | socius "what broke?"
socius "explain this compiler error" < build.log
```

It should feel like `grep`, not like ChatGPT: streaming, keyboard-first, composable, private.

## Status

**Pre-alpha (M0).** Architecture and scaffolding. See [`docs/`](./docs) for the full design and
[`docs/17-roadmap.md`](./docs/17-roadmap.md) for milestones. Nothing here is stable yet.

## Design principles

1. **You own every byte.** No account, no cloud, no telemetry. Knowledge lives in plain Markdown;
   state lives in a single local SQLite file.
2. **Graceful degradation.** If Gmail fails the filesystem still works; if the LLM crashes your
   notes still exist; if MCP disappears native tools still run.
3. **The LLM reasons; software executes.** The model never touches the OS directly —
   `LLM → Planner → Permission Layer → validated Tool → Execution`.
4. **Deterministic over probabilistic.** If code can compute it, code computes it.
5. **Everything is inspectable.** Memory, logs, reasoning traces, config, prompts, tool schemas.
6. **Everything is modular.** Every subsystem is replaceable behind a stable interface.

## Architecture at a glance

A thin `socius` CLI talks over a Unix socket to a lazy-spawned daemon (`sociusd`) that holds the
model resident and owns memory, planning, and tools. See
[`docs/01-architecture.md`](./docs/01-architecture.md) and
[`docs/02-process-model.md`](./docs/02-process-model.md).

## Hardware target

Runs comfortably on modest local hardware (developed against an RTX 3050 laptop, 4 GB VRAM, via
[`llama.cpp`](https://github.com/ggml-org/llama.cpp)). The model backend is an interface — swap in
a larger local model or a remote OpenAI-compatible endpoint with zero changes above the inference
layer.

## Development

```sh
bun install
bun run typecheck
bun test
```

Requires [Bun](https://bun.sh) ≥ 1.3 and a local `llama-server` build. See
[`docs/15-dev-workflow.md`](./docs/15-dev-workflow.md).

## License

[MIT](./LICENSE) © toeeshchaudhary
