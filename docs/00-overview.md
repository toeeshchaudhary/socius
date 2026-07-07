# 00 — Overview

## What Socius is

Socius is a **local-first AI operating companion** for the terminal. Think of it as an
intelligent Unix citizen: something that lives alongside `grep`, `git`, and `journalctl`,
composes with them through pipes, remembers your projects, and reasons about your work — all on
your own machine, with no account and no cloud.

```sh
git diff | socius "review this"
journalctl -p err -b | socius "what broke?"
socius "explain this compiler error" < build.log
find . -name '*.cpp' | socius "which of these touch the renderer?"
```

The large language model is **one component**, not the product. Socius is the system around it:
Intelligence, Memory, Planning, Execution, Permissions, UI, Storage, and Tooling. If the model
we use today (Gemma via llama.cpp) were replaced tomorrow, the architecture would not change.

## What Socius is *not*

- **Not a chatbot.** The primary interface is the CLI, and it composes with pipes. A GUI is
  optional and comes much later; the terminal is mandatory.
- **Not a ChatGPT clone.** It is not a wrapper that forwards your prompt to a model and prints
  the reply. The intelligence is subordinate to a planner, a memory system, and a permission
  layer.
- **Not an Electron app around an LLM.** It is a daemon + a thin native-feeling CLI.
- **Not cloud software.** No account, no server, no telemetry. Deleting Socius should leave
  behind a folder of Markdown that is still useful on its own.

## The six principles

These are load-bearing. When a design decision is ambiguous, resolve it in favor of the
principle with the lower number.

1. **You own every byte.** Nothing important is hidden inside a prompt. No cloud storage, no
   account. Knowledge lives in plain Markdown; structured state lives in one local SQLite file.
2. **Everything degrades gracefully.** If Gmail fails, the filesystem still works. If the LLM
   crashes, your notes still exist. If MCP disappears, native tools still run. Each subsystem
   fails in isolation behind its interface.
3. **The LLM reasons; software executes.** The model never touches the OS directly. The path is
   always `LLM → Planner → Permission Layer → validated Tool → Execution`.
4. **Deterministic over probabilistic.** If traditional code can compute something, code
   computes it. The model is used only where it is genuinely superior (natural language,
   fuzzy judgement, summarization).
5. **Everything is inspectable.** Memory, logs, reasoning traces, configuration, prompt
   templates, and tool schemas are all readable and editable. Nothing is hidden.
6. **Everything is modular.** Every subsystem sits behind a stable interface and is
   independently replaceable.

## Why these principles, and what they cost

**Local-first (P1) trades capability for ownership and privacy.** A 4 GB-VRAM local model is
far weaker than a frontier cloud model. We accept that because the entire value proposition is a
companion that is *yours* — always available, private, and durable across the decade. Where a
bigger brain is genuinely needed, P6 lets us configure a remote backend behind the same
interface without rewriting anything.

**Graceful degradation (P2) trades some simplicity for resilience.** Returning explicit
`Result` values and isolating subsystems is more code than letting exceptions fly. It is worth
it for a tool meant to be depended on daily: a broken Gmail token must never take down note-taking.

**Deterministic-first (P4) trades "magic" for reliability.** It would be less code to hand the
model tools and a while-loop. On a small local model that produces a flaky agent that loops and
hallucinates. A daily driver that is flaky gets uninstalled. See [`06-planner.md`](./06-planner.md).

## The long-term goal

Socius should become the first application opened every morning — a second brain that summarizes
mail and calendar, shows what changed in your repos, remembers architectural decisions, explains
errors, and grows with you over years. This document set exists so that ambition is built on a
foundation that is still elegant five years from now, rather than a weekend prototype that
collapses under its own features.
