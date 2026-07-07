import { describe, expect, test } from "bun:test";
import type {
  BackendHealth,
  CompletionChunk,
  CompletionRequest,
  InferenceBackend,
  PlanContext,
  Result,
  Tool,
  ToolContext,
  ToolResult,
} from "@socius/core";
import { asRequestId, asTraceId, ok } from "@socius/core";
import { ConfiguredPolicyEngine } from "@socius/permissions";
import { InMemoryToolRegistry, ToolRunner } from "@socius/tools";
import { GraphPlanner } from "./graph.ts";

/** Fake backend: structured (decide) calls return scripted JSON; streaming
 * (answer) calls return scripted tokens. */
class ScriptedBackend implements InferenceBackend {
  readonly id = "scripted";
  private decideCall = 0;
  constructor(
    private readonly decisions: string[],
    private readonly answer: string[],
  ) {}
  async *complete(req: CompletionRequest): AsyncIterable<CompletionChunk> {
    if (req.responseSchema) {
      const json = this.decisions[Math.min(this.decideCall, this.decisions.length - 1)]!;
      this.decideCall++;
      yield { type: "token", text: json };
      yield { type: "done", text: "" };
      return;
    }
    for (const t of this.answer) yield { type: "token", text: t };
    yield { type: "done", text: "" };
  }
  async countTokens(): Promise<Result<number>> {
    return ok(0);
  }
  contextWindow() {
    return 4096;
  }
  async health(): Promise<BackendHealth> {
    return { healthy: true, modelId: "scripted", contextWindow: 4096 };
  }
}

const echoTool: Tool = {
  name: "echo",
  description: "Echo the given message",
  source: "native",
  inputSchema: { type: "object", properties: { msg: { type: "string" } } },
  outputSchema: {},
  capabilities: ["fs.read"],
  capabilityTags: ["test"],
  destructive: false,
  async invoke(args: unknown, _c: ToolContext): Promise<Result<ToolResult>> {
    return ok({ data: { echoed: (args as { msg?: string }).msg }, summary: "echoed" });
  },
};

const policy = new ConfiguredPolicyEngine({ "fs.read": "allow" });
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  requestId: asRequestId("r1"),
  traceId: asTraceId("t1"),
  input: "say hi",
  ...over,
});

function makePlanner(backend: InferenceBackend) {
  const registry = new InMemoryToolRegistry();
  registry.register(echoTool);
  return new GraphPlanner({
    backend,
    systemPrompt: "sys",
    tools: registry,
    runner: new ToolRunner(policy),
    maxToolCalls: 3,
  });
}

async function collect(planner: GraphPlanner, c: PlanContext) {
  const steps: string[] = [];
  let answer = "";
  let done = false;
  for await (const ev of planner.run(c)) {
    if (ev.type === "step" && ev.step) steps.push(`${ev.step.node}:${ev.step.label}`);
    if (ev.type === "token" && ev.token) answer += ev.token;
    if (ev.type === "done") done = true;
  }
  return { steps, answer, done };
}

describe("GraphPlanner", () => {
  test("calls a tool then answers with the result", async () => {
    // structured calls interleave: decide -> planArgs -> decide
    const backend = new ScriptedBackend(
      ['{"action":"tool","tool":"echo","reason":"needed"}', '{"msg":"hi"}', '{"action":"answer"}'],
      ["done", "!"],
    );
    const { steps, answer, done } = await collect(makePlanner(backend), ctx());
    expect(steps.some((s) => s.startsWith("tool_call:echo"))).toBe(true);
    expect(steps.some((s) => s.startsWith("plan:echo"))).toBe(true);
    expect(answer).toBe("done!");
    expect(done).toBe(true);
  });

  test("answers directly when no tool is needed", async () => {
    const backend = new ScriptedBackend(['{"action":"answer"}'], ["hello"]);
    const { steps, answer } = await collect(makePlanner(backend), ctx());
    expect(steps.some((s) => s.startsWith("tool_call"))).toBe(false);
    expect(answer).toBe("hello");
  });

  test("degrades to answering when the model picks an unknown tool", async () => {
    const backend = new ScriptedBackend(
      ['{"action":"tool","tool":"nope","args":{}}'],
      ["fallback"],
    );
    const { steps, answer } = await collect(makePlanner(backend), ctx());
    expect(steps.some((s) => s.includes("unknown tool"))).toBe(true);
    expect(answer).toBe("fallback");
  });

  test("reflects after a tool failure and can still answer (self-correction)", async () => {
    const failing: Tool = {
      ...echoTool,
      name: "boom",
      async invoke(): Promise<Result<ToolResult>> {
        return {
          ok: false,
          error: {
            code: "TOOL_FAILED",
            subsystem: "tools",
            message: "kaboom",
            recoverable: true,
            name: "SociusError",
          } as never,
        };
      },
    };
    const registry = new InMemoryToolRegistry();
    registry.register(failing);
    const backend = new ScriptedBackend(
      ['{"action":"tool","tool":"boom"}', '{"msg":"x"}', '{"action":"answer"}'],
      ["recovered"],
    );
    const planner = new GraphPlanner({
      backend,
      systemPrompt: "sys",
      tools: registry,
      runner: new ToolRunner(policy),
    });
    const steps: string[] = [];
    let answer = "";
    for await (const ev of planner.run(ctx())) {
      if (ev.type === "step" && ev.step) steps.push(`${ev.step.node}:${ev.step.label}`);
      if (ev.type === "token" && ev.token) answer += ev.token;
    }
    expect(steps.some((s) => s.startsWith("reflect"))).toBe(true);
    expect(answer).toBe("recovered");
  });

  test("respects the maxToolCalls bound (no infinite loop)", async () => {
    // Always asks for a tool — must stop at maxToolCalls, then answer.
    const backend = new ScriptedBackend(
      ['{"action":"tool","tool":"echo","args":{"msg":"x"}}'],
      ["stopped"],
    );
    const { steps, answer } = await collect(makePlanner(backend), ctx());
    expect(steps.filter((s) => s.startsWith("tool_call")).length).toBe(3);
    expect(answer).toBe("stopped");
  });
});
