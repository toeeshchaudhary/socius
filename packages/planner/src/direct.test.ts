import { describe, expect, test } from "bun:test";
import type {
  BackendHealth,
  CompletionChunk,
  CompletionRequest,
  InferenceBackend,
  PlanContext,
  Result,
} from "@socius/core";
import { asRequestId, asTraceId, ok } from "@socius/core";
import { DirectPlanner } from "./index.ts";

/**
 * The LLM test double: a deterministic backend that echoes scripted tokens.
 * Tests never need a GPU or a running model — this is the pattern every planner
 * and slot test uses (see docs/14-testing.md).
 */
class FakeBackend implements InferenceBackend {
  readonly id = "fake";
  lastRequest?: CompletionRequest;
  constructor(private readonly tokens: readonly string[]) {}
  async *complete(req: CompletionRequest): AsyncIterable<CompletionChunk> {
    this.lastRequest = req;
    for (const t of this.tokens) yield { type: "token", text: t };
    yield { type: "done", text: "" };
  }
  async countTokens(): Promise<Result<number>> {
    return ok(0);
  }
  contextWindow(): number {
    return 8192;
  }
  async health(): Promise<BackendHealth> {
    return { healthy: true, modelId: "fake", contextWindow: 8192 };
  }
}

const ctx = (over: Partial<PlanContext>): PlanContext => ({
  requestId: asRequestId("r1"),
  traceId: asTraceId("t1"),
  input: "hello",
  ...over,
});

describe("DirectPlanner", () => {
  test("streams the backend's tokens then a done event", async () => {
    const backend = new FakeBackend(["Hel", "lo", "!"]);
    const planner = new DirectPlanner({ backend, systemPrompt: "sys" });

    const tokens: string[] = [];
    let done = false;
    for await (const ev of planner.run(ctx({}))) {
      if (ev.type === "token" && ev.token) tokens.push(ev.token);
      if (ev.type === "done") done = true;
    }
    expect(tokens.join("")).toBe("Hello!");
    expect(done).toBe(true);
  });

  test("appends piped stdin to the user message", async () => {
    const backend = new FakeBackend(["ok"]);
    const planner = new DirectPlanner({ backend, systemPrompt: "sys" });
    for await (const _ of planner.run(ctx({ input: "review", stdin: "diff --git" }))) {
      /* drain */
    }
    const userMsg = backend.lastRequest?.messages.at(-1);
    expect(userMsg?.content).toContain("review");
    expect(userMsg?.content).toContain("diff --git");
  });
});
