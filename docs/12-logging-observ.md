# 12 — Logging & Observability

Principle #5: everything is inspectable. Two distinct streams serve two distinct questions.
Reference: `packages/logging/`.

## Two streams

1. **Operational logs** — "what is the daemon doing?" Structured JSON, one object per line,
   with `level`, `subsystem`, `msg`, and fields. Written to **stderr** (never stdout — stdout is
   sacred for piped output, so `git diff | socius … > out.txt` is never polluted) and to
   `~/.local/state/socius/logs/`.

2. **Reasoning traces** — "what did the model see and decide?" A separate stream capturing every
   LLM interaction verbatim:

```ts
interface ReasoningTrace {
  traceId; slot;              // which planner slot
  prompt;                     // exactly what the model was given
  rawOutput; validatedOutput; // what it returned, before and after schema validation
  valid;                      // did it satisfy the slot contract?
  latencyMs; promptTokens; completionTokens;
}
```

`socius trace [n]` replays the last `n` reasoning slots: for each, the slot name (`decide`,
`plan:<tool>`, `answer`), the exact prompt the model saw, its raw output, whether the output was
schema-valid, and the latency. `--full` shows untruncated prompts/outputs. This turns "the AI did
something weird" into a debuggable artifact — the antidote to the black-box agent.

*Implemented:* `FileTraceSink` (in `@socius/logging`) appends each slot as JSON Lines to
`~/.local/state/socius/traces.jsonl`; the planner slots (`packages/planner/src/slots.ts`) record
into it. Disable with `logging.traces = false`.

## Levels

`debug` ‹ `info` ‹ `warn` ‹ `error`, set by config. The `Logger` interface supports `child()` so
each subsystem logs with its own tag, making it trivial to filter (`… | jq 'select(.sub=="memory")'`).

## Redaction

Secrets are redacted **at the sink**, not left to callers to remember. Known-sensitive fields
(tokens, passwords, `secrets`-capability tool args) are masked before a line is written to disk.
The reasoning trace, which by nature contains prompt content, is subject to the same redaction and
can be disabled entirely (`logging.traces = false`) for maximum privacy.

## `socius doctor`

The health command aggregates observability into one status view:
- config valid? model file present? GPU visible?
- daemon socket alive? llama-server children healthy?
- DB migrations current? knowledge index fresh?
- MCP servers up or down (with last error)?

It is the first thing to run when something is off, and it embodies the degradation matrix from
[`13-errors-resilience.md`](./13-errors-resilience.md): each subsystem reports its own health
independently, so a red line points straight at the failing module.

## What we do not do

No telemetry, no phone-home, no remote error reporting — ever (Principle #1). Observability is
entirely local and entirely yours. Crash diagnostics stay on your disk; sharing them is a
deliberate, manual act.
