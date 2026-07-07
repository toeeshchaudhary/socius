/**
 * @socius/planner — the deterministic state-graph planner. Control flow is
 * TypeScript; the LLM is invoked only at slot nodes with schema-validated output.
 *
 * For M1, the "graph" is a single straight line: retrieve(none) → answer. The
 * pipe-to-reason path streams a completion directly. The node library and
 * bounded recursion arrive in M3, behind this same `Planner` interface.
 */
import type { InferenceBackend, PlanContext, PlanEvent, Planner } from "@socius/core";

export interface DirectPlannerDeps {
  readonly backend: InferenceBackend;
  readonly systemPrompt: string;
}

/**
 * M1 planner: no tools, no memory — just stream the model's answer to the input
 * (+ piped stdin). This proves the spine end-to-end.
 */
export class DirectPlanner implements Planner {
  constructor(private readonly deps: DirectPlannerDeps) {}

  async *run(ctx: PlanContext): AsyncIterable<PlanEvent> {
    const userContent = ctx.stdin ? `${ctx.input}\n\n---\n${ctx.stdin}` : ctx.input;
    const stream = this.deps.backend.complete({
      messages: [
        { role: "system", content: this.deps.systemPrompt },
        { role: "user", content: userContent },
      ],
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    for await (const chunk of stream) {
      if (chunk.type === "token") yield { type: "token", token: chunk.text };
    }
    yield { type: "done" };
  }
}
