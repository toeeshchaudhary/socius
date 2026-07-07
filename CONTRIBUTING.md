# Contributing to Socius

Thanks for your interest. Socius is built to be contributed to — the test suite is hermetic (no GPU,
model, or network required), the module boundaries are strict, and every hard decision is recorded as
an ADR.

## Getting started

```sh
git clone https://github.com/toeeshchaudhary/socius.git
cd socius
bun install
bun run typecheck    # tsc --build across all packages
bun test             # hermetic — runs in seconds
bun run lint         # biome
```

Requires [Bun](https://bun.sh) ≥ 1.3. Running the *live* app additionally needs a `llama-server` build
and a GGUF model (see [`docs/USAGE.md`](./docs/USAGE.md)), but you do **not** need those to develop or
test.

## Architecture in one paragraph

A thin `socius` CLI talks over a Unix socket to a lazy-spawned daemon (`sociusd`) that holds the model
resident and owns memory, planning, tools, and permissions. It's a Bun monorepo; every package depends
only on `@socius/core`'s interfaces, never on a sibling's implementation. Read
[`docs/01-architecture.md`](./docs/01-architecture.md) first, then the subsystem docs and
[`docs/adr/`](./docs/adr).

## Repository layout

```
packages/
  core         Contracts (types + interfaces). Zero runtime deps.
  config       TOML config loader, XDG paths, defaults.
  logging      Structured logger + reasoning-trace sink.
  storage      SQLite + sqlite-vec + FTS5, migrations.
  inference    llama.cpp adapter + embedders (behind InferenceBackend/Embedder).
  memory       Retrieval-first memory store.
  knowledge    Markdown knowledge base indexer.
  permissions  Capability policy engine.
  tools        Unified Tool interface + native tools + ToolRunner.
  mcp          MCP client (connects servers, wraps tools as native).
  planner      Deterministic state-graph planner + LLM slots.
  daemon       sociusd — owns the model, wires everything, serves IPC.
  cli          socius — thin client (+ `socius serve` MCP server).
scripts/       install.sh, dev/e2e scripts.
docs/          architecture (00–18), ADRs, USAGE, RUNBOOK.
```

## Coding standards

- **Errors as values.** Return `Result<T, SociusError>` for expected failures; throw only for bugs.
- **Interfaces live in `core`; implementations in their package.** New subsystem? Define its interface
  in `core`, write a test double, then implement. Don't add runtime deps to `core`.
- **`.ts` import extensions** (Bun runs TypeScript directly; tsc uses `allowImportingTsExtensions` +
  `emitDeclarationOnly`).
- **stdout is sacred** — only user-facing answer content goes to stdout; logs/diagnostics go to stderr,
  so Socius composes in pipes.
- **No hidden prompts or magic strings** — prompts are files; config drives behavior.
- Formatting/linting is [Biome](https://biomejs.dev); run `bun run format` before committing.

## Adding things

- **A native tool** — implement `Tool` in `packages/tools`, declare `capabilities` + `capabilityTags`,
  add a schema/behavior test. No planner changes. Register it in `builtinTools()`.
- **A planner node/slot** — add it behind the `Planner` graph; unit-test with a scripted fake backend.
- **An inference backend** — implement `InferenceBackend`; select by config.
- **An MCP server** — no code; add a `[[mcp]]` block to config.

## Testing

- **Unit/contract tests** cover deterministic logic and use a **fake `InferenceBackend`** so nothing
  needs a model. See `packages/planner/src/*.test.ts` for the pattern.
- **Integration tests** use real SQLite (temp files) and a real Unix socket, still no model
  (`packages/daemon/src/daemon.test.ts`).
- Live, model-dependent checks are the `scripts/*-e2e.ts` scripts (documented in
  [`docs/RUNBOOK.md`](./docs/RUNBOOK.md)); they are not part of `bun test`.

A change is **done** when it typechecks, is covered by hermetic tests, lints, and its docs (and any
prompts) are updated. Details: [`docs/14-testing.md`](./docs/14-testing.md).

## Commits & PRs

- [Conventional commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `chore:`,
  `refactor:`, `test:`.
- Work on a branch; open a PR. CI runs lint + typecheck + tests.
- A hard architectural decision gets an ADR in `docs/adr/` in the same PR.

## License

By contributing you agree your contributions are licensed under the project's [MIT License](./LICENSE).
