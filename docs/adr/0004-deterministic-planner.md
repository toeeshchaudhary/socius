# ADR-0004 — Deterministic state-graph planner, LLM-in-slots

Status: Accepted
Date: 2026-07-07

## Context
The brief asks for real *planning*, not naive tool-calling: decide when to use tools, memory,
clarification, confirmation, reflection, decomposition, retries. But the reasoning model is small
(4B) and unreliable at open-ended autonomy. Principle #4 says prefer deterministic code.

## Decision
The planner is a typed state graph written in TypeScript. Edges (control flow) are code. The LLM
is invoked only at **slot** nodes, each asking a narrow, schema-constrained question (classify
intent, extract tool args, judge if the goal is met), with output constrained by grammar and
validated by schema. Decomposition/retries are supported but **bounded** by a depth cap and step
budget — no open loops on model judgement.

## Alternatives considered
1. Autonomous ReAct-style agent: give the model tools + a `while` loop.
2. Pure hardcoded flows with no planning flexibility.

## Tradeoffs
More engineering up front (a graph engine, per-slot schemas) than a while-loop. Gained:
reliability on a weak model, a fully inspectable `PlanStep` trace, and no runaway loops.

## Long-term implications
The `Planner` interface (`run → AsyncIterable<PlanEvent>`) admits a future `AutonomousPlanner`
for when a capable backend is configured — autonomy becomes an opt-in earned by the model, not
the default. The deterministic graph stays the safe reference implementation.

## Why the alternatives were rejected
1. Autonomous loops on a 4B model hallucinate tool calls, loop, and lose the thread → a flaky
   daily-driver, which gets uninstalled. They also violate P4 (control flow is code's job) and P5
   (not inspectable).
2. Fully hardcoded flows can't handle the open-ended natural-language surface the product needs;
   the LLM-in-slots design keeps flexibility exactly where a model is superior and nowhere else.
