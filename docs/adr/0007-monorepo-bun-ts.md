# ADR-0007 — Bun + TypeScript monorepo

Status: Accepted
Date: 2026-07-07

## Context
The project targets 100k+ LOC, open source, external contributors, and daily use for a decade.
The developer is fluent in TypeScript; the reasoning runtime (llama.cpp) is out-of-process over
HTTP. We need a toolchain that is fast, has strong types for large-codebase safety, and keeps
module boundaries crisp.

## Decision
A Bun workspace monorepo in strict TypeScript, one package per subsystem, with `@socius/core` as
a dependency-free contract package that everything else depends on downward. Bun is the runtime,
test runner, and package manager; Biome is the single lint+format tool; tsc drives project
references for typechecking.

## Alternatives considered
1. Python (richest local-AI ecosystem).
2. Rust/Go (a true systems daemon).
3. Node.js instead of Bun; npm/pnpm workspaces; a polyrepo.

## Tradeoffs
TypeScript/Bun is an orchestration layer over a C++ inference process, not a from-scratch systems
stack — fine, since the heavy compute is in llama.cpp. Bun is younger than Node but ships a fast
all-in-one toolchain (runtime + test + bundler + sqlite) that removes a lot of config. Monorepo
needs project-reference discipline; that discipline *is* the module-boundary enforcement we want.

## Long-term implications
Strong types + interface-only cross-package deps keep the codebase navigable at scale and lower
the barrier for contributors. `core` staying dependency-free is the linchpin; a PR adding runtime
deps to `core` is a red flag.

## Why the alternatives were rejected
1. Python's typing and packaging are weaker for a long-lived 100k-LOC codebase, and the developer
   is a TS person; the AI ecosystem advantage is largely irrelevant when inference is a separate
   llama.cpp process.
2. Rust/Go would be excellent for the daemon but slow iteration and shrink the contributor pool
   for what is mostly orchestration and I/O; the model isn't in-process anyway.
3. Node works but Bun's integrated tooling (native SQLite, fast test runner) reduces moving parts;
   polyrepo would make early interface churn painful across many repos for a small team.
