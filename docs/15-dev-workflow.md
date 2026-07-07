# 15 — Developer Workflow

Socius is built to be contributed to. This document is what a new contributor reads first.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- A local [`llama.cpp`](https://github.com/ggml-org/llama.cpp) build with `llama-server`
  (CUDA optional; CPU works for development)
- A GGUF chat model and a GGUF embedding model (for running, not for the test suite)

## Getting started

```sh
git clone <repo> socius && cd socius
bun install
bun run typecheck     # tsc --build across all packages
bun test              # hermetic: no GPU, no model, no network
bun run lint          # biome
```

To run the CLI in development: `bun run socius doctor` (or `bun run packages/cli/src/main.ts …`).

## Monorepo shape

Bun workspaces, one concern per package, strict TypeScript project references. The golden rule:
**depend only on `@socius/core`'s interfaces, never on a sibling's implementation.** If package A
needs package B's concrete class, that is a smell — the shared abstraction belongs in `core`.

- Imports use explicit `.ts` extensions (Bun runs TypeScript directly; tsc is configured with
  `allowImportingTsExtensions` + `emitDeclarationOnly`).
- `packages/core` must stay dependency-free. A PR adding a runtime dep to `core` needs a very good
  reason.

## Coding standards

- **Errors as values.** Return `Result<T, SociusError>` for expected failures; throw only for
  bugs ([`13-errors-resilience.md`](./13-errors-resilience.md)).
- **Interfaces in `core`, implementations in packages.** New subsystem? Define its interface in
  `core` first, write a test double, then implement.
- **No hidden prompts or magic strings.** Prompts are files; config drives behavior.
- **stdout is sacred.** Logs and diagnostics go to stderr; only user-facing answer content goes to
  stdout, so Socius composes in pipes.
- Formatting/linting is Biome; CI enforces it. Run `bun run format` before committing.

## Adding things

- **A native tool:** implement `Tool` in `packages/tools`, declare its `capabilities` and
  `capabilityTags`, add a schema test. No planner changes ([`07-tools.md`](./07-tools.md)).
- **A planner node:** add it to the node library behind the `Planner` graph; unit-test it with a
  `FakeBackend`.
- **An inference backend:** implement `InferenceBackend`, select it by config
  ([`03-intelligence.md`](./03-intelligence.md)).
- **An MCP server:** no code — add a `[[mcp]]` block to config ([`08-mcp.md`](./08-mcp.md)).

## Commits and branches

- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- Work on branches; PRs run the full CI matrix.
- A hard architectural decision gets an ADR in `docs/adr/` in the same PR that introduces it.

## Definition of done

A change is done when: it typechecks, it is covered by unit/contract tests, it lints, its docs are
updated, and — if it altered the model's behavior — its prompts and any eval fixtures are updated.
