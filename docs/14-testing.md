# 14 — Testing

The test suite must run **without a GPU, without a model, and without network** — on CI, on a
contributor's laptop, in seconds. That constraint drives the whole strategy. Runner: `bun test`.

## The levels

1. **Unit tests** — pure logic, no I/O. The policy engine, the reranker, the tool registry,
   config validation, prompt templating. These are the bulk of the suite and run instantly.
   Example: `packages/permissions/src/policy.test.ts`.

2. **Contract tests** — a module against an interface using a **test double** for its
   dependencies. The planner is tested against a `FakeBackend` that emits scripted tokens
   (`packages/planner/src/direct.test.ts`), so planner logic is verified with zero inference
   cost. Every `@socius/core` interface gets a reusable fake.

3. **Integration tests** — real SQLite (a temp file), real file I/O, real IPC over a temp
   socket — but still no model. These verify migrations, memory round-trips, and the CLI↔daemon
   handshake.

4. **Eval tests (gated)** — the only tests that touch a real model. They measure *quality*
   (does classification pick the right intent? does retrieval surface the right memory?) against
   a small fixture set, and run only when `SOCIUS_EVAL=1` and a model is present. They never gate
   CI; they gate releases and prompt changes.

## The LLM test double

The single most important testing pattern. Because `InferenceBackend` is an interface, tests
inject a deterministic fake:

```ts
class FakeBackend implements InferenceBackend {
  constructor(private tokens: string[]) {}
  async *complete() { for (const t of this.tokens) yield { type: "token", text: t }; yield { type: "done", text: "" }; }
  // …
}
```

This makes model-dependent code **deterministically testable**: planner control flow, slot
retry-on-invalid, streaming relay, cancellation. Non-determinism is quarantined to the eval
level, where it belongs.

## What each layer proves

- Unit/contract: **correctness of the machine** — the parts that must never regress and are
  cheap to check.
- Integration: **the seams hold** — data actually survives a round-trip, the protocol actually
  round-trips.
- Eval: **the model behaves well enough** — quality regressions from a prompt or model change are
  caught before release.

## Coverage philosophy

We do not chase a coverage percentage. We cover: every `Result`-returning error path, every
policy decision, every migration, and every planner edge. Deterministic code (Principle #4) is
exhaustively testable and *is* tested; the probabilistic layer is evaluated, not asserted.

## CI

`bun run lint && bun run typecheck && bun test` on every push/PR
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). No GPU, no model download — the suite
is hermetic. Eval runs are a separate, manual/nightly job with a model cached.
