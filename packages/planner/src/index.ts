/**
 * @socius/planner — the deterministic state-graph planner. Control flow is
 * TypeScript; the LLM is invoked only at slot nodes with schema-validated output.
 *
 * For M1 the graph was a single line (answer). M2 adds a deterministic Retrieve
 * step in front: pull the most relevant memories and inject them as context.
 * The node library and bounded recursion arrive in M3, behind this interface.
 */
import type { InferenceBackend, MemoryStore, PlanContext, PlanEvent, Planner } from "@socius/core";

export { GraphPlanner, type GraphPlannerDeps } from "./graph.ts";
export { completeStructured, streamAnswer, parseJson } from "./slots.ts";

export interface DirectPlannerDeps {
  readonly backend: InferenceBackend;
  readonly systemPrompt: string;
  /** Optional: when present, relevant memories are retrieved and injected. */
  readonly memory?: MemoryStore;
  /** Token budget for injected memory context. */
  readonly memoryTokenBudget?: number;
}

/**
 * M1/M2 planner: (optionally) retrieve memory, then stream the model's answer to
 * the input (+ piped stdin). No tools yet.
 */
export class DirectPlanner implements Planner {
  constructor(private readonly deps: DirectPlannerDeps) {}

  async *run(ctx: PlanContext): AsyncIterable<PlanEvent> {
    let memoryBlock = "";
    if (this.deps.memory) {
      const query = ctx.stdin ? `${ctx.input}\n${ctx.stdin.slice(0, 2000)}` : ctx.input;
      const r = await this.deps.memory.retrieve({
        text: query,
        ...(this.deps.memoryTokenBudget ? { tokenBudget: this.deps.memoryTokenBudget } : {}),
      });
      if (r.ok && r.value.length > 0) {
        yield {
          type: "step",
          step: {
            node: "retrieve",
            label: `recalled ${r.value.length} memories`,
            startedAt: 0,
            durationMs: 0,
          },
        };
        memoryBlock = `\n\nRelevant things you remember (may or may not be useful):\n${r.value
          .map((m) => `- ${m.memory.content}`)
          .join("\n")}`;
      }
    }

    const userContent = ctx.stdin ? `${ctx.input}\n\n---\n${ctx.stdin}` : ctx.input;
    const stream = this.deps.backend.complete({
      messages: [
        { role: "system", content: this.deps.systemPrompt + memoryBlock },
        { role: "user", content: userContent },
      ],
      ...(ctx.maxTokens ? { maxTokens: ctx.maxTokens } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    for await (const chunk of stream) {
      if (chunk.type === "token") yield { type: "token", token: chunk.text };
    }
    yield { type: "done" };
  }
}
