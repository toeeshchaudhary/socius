/**
 * GraphPlanner — the deterministic state graph (M3). Control flow is TypeScript;
 * the LLM fills two narrow slots: a schema-constrained "decide" slot (tool or
 * answer?) and the streaming "answer" slot. Tool calls go through the ToolRunner,
 * so permissions are always enforced. Bounded by maxToolCalls — no open loops.
 */
import type {
  ExecutionMode,
  InferenceBackend,
  MemoryStore,
  PlanContext,
  PlanEvent,
  PlanNodeKind,
  Planner,
  Tool,
  ToolRegistry,
} from "@socius/core";
import { asToolCallId } from "@socius/core";
import type { ToolRunner } from "@socius/tools";
import { completeStructured, streamAnswer } from "./slots.ts";

export interface GraphPlannerDeps {
  readonly backend: InferenceBackend;
  readonly systemPrompt: string;
  readonly tools: ToolRegistry;
  readonly runner: ToolRunner;
  readonly memory?: MemoryStore;
  readonly mode?: ExecutionMode;
  readonly maxToolCalls?: number;
  readonly memoryTokenBudget?: number;
}

interface Decision {
  action: "answer" | "tool";
  tool?: string;
  args?: Record<string, unknown>;
  reason?: string;
}

const DECIDE_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["answer", "tool"] },
    tool: { type: "string" },
    args: { type: "object" },
    reason: { type: "string" },
  },
  required: ["action"],
};

interface ToolOutcome {
  tool: string;
  ok: boolean;
  summary: string;
  data: unknown;
}

export class GraphPlanner implements Planner {
  private readonly maxToolCalls: number;
  private readonly mode: ExecutionMode;

  constructor(private readonly deps: GraphPlannerDeps) {
    this.maxToolCalls = deps.maxToolCalls ?? 3;
    this.mode = deps.mode ?? "live";
  }

  async *run(ctx: PlanContext): AsyncIterable<PlanEvent> {
    // 1. Retrieve memory (deterministic).
    const memoryBlock = await this.retrieve(ctx);
    if (memoryBlock.label) yield step("retrieve", memoryBlock.label);

    const tools = this.deps.tools.all();
    const outcomes: ToolOutcome[] = [];

    // 2. Bounded decide → tool loop.
    for (let i = 0; i < this.maxToolCalls; i++) {
      const decision = await this.decide(ctx, memoryBlock.text, tools, outcomes);
      if (decision.action !== "tool" || !decision.tool) break;
      const tool = this.deps.tools.get(decision.tool);
      if (!tool) {
        yield step("plan", `model picked unknown tool '${decision.tool}', answering directly`);
        break;
      }
      yield step("tool_call", `${tool.name}${decision.reason ? ` — ${decision.reason}` : ""}`);
      const res = await this.deps.runner.run(tool, decision.args ?? {}, {
        mode: this.mode,
        reasoning: decision.reason ?? `use ${tool.name}`,
        ctx: { callId: asToolCallId(`${ctx.requestId}-${i}`), ...(ctx.signal ? { signal: ctx.signal } : {}) },
      });
      if (res.ok) {
        outcomes.push({ tool: tool.name, ok: true, summary: res.value.summary ?? tool.name, data: res.value.data });
      } else {
        // Reflect: record the failure and loop — the next decide() sees it in
        // "Tool results so far" and can correct (different tool/args) or answer.
        // Bounded by maxToolCalls, so a persistently-failing tool can't spin.
        yield step("reflect", `${tool.name} failed: ${res.error.message} — reconsidering`);
        outcomes.push({ tool: tool.name, ok: false, summary: `ERROR: ${res.error.message}`, data: null });
      }
    }

    // 3. Answer (stream), with memory + tool results in context.
    const contextBlock = buildContext(memoryBlock.text, outcomes);
    for await (const token of streamAnswer(this.deps.backend, {
      system: this.deps.systemPrompt + contextBlock,
      input: ctx.input,
      ...(ctx.stdin ? { stdin: ctx.stdin } : {}),
      ...(ctx.maxTokens ? { maxTokens: ctx.maxTokens } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    })) {
      yield { type: "token", token };
    }
    yield { type: "done" };
  }

  private async retrieve(ctx: PlanContext): Promise<{ text: string; label: string }> {
    if (!this.deps.memory) return { text: "", label: "" };
    const query = ctx.stdin ? `${ctx.input}\n${ctx.stdin.slice(0, 2000)}` : ctx.input;
    const r = await this.deps.memory.retrieve({
      text: query,
      ...(this.deps.memoryTokenBudget ? { tokenBudget: this.deps.memoryTokenBudget } : {}),
    });
    if (!r.ok || r.value.length === 0) return { text: "", label: "" };
    const text = r.value.map((m) => `- ${m.memory.content}`).join("\n");
    return { text, label: `recalled ${r.value.length} memories` };
  }

  private async decide(
    ctx: PlanContext,
    memory: string,
    tools: readonly Tool[],
    outcomes: readonly ToolOutcome[],
  ): Promise<Decision> {
    if (tools.length === 0) return { action: "answer" };
    // Compact listing: name + short description + param names only. Including full
    // JSON Schemas here overflows the context once tools (e.g. MCP) have large
    // schemas. The model fills args from param names; invalid args are caught by
    // the tool and handled by the reflect loop.
    const toolList = tools
      .map((t) => `- ${t.name}: ${clip(t.description, 140)} (params: ${paramNames(t.inputSchema) || "none"})`)
      .join("\n");
    const priorResults = outcomes.length
      ? `\nTool results so far:\n${outcomes.map((o) => `- ${o.tool}: ${o.summary}`).join("\n")}`
      : "";
    const system =
      "You decide whether a tool call is needed to answer the user's request, or whether you can answer directly. " +
      "Only use a tool if it is clearly required to get information you do not have. " +
      `Available tools:\n${toolList}\n` +
      "Respond with JSON only: {\"action\":\"answer\"} to answer directly, or " +
      '{"action":"tool","tool":"<name>","args":{...},"reason":"<why>"} to call a tool.';
    const user = `Request: ${ctx.input}${ctx.stdin ? `\n(has piped input)` : ""}${memory ? `\nContext:\n${memory}` : ""}${priorResults}`;

    const decision = await completeStructured<Decision>(
      this.deps.backend,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      DECIDE_SCHEMA,
      ctx.signal,
    );
    return decision ?? { action: "answer" };
  }
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function paramNames(schema: unknown): string {
  const props = (schema as { properties?: Record<string, unknown> })?.properties;
  return props ? Object.keys(props).join(", ") : "";
}

function buildContext(memory: string, outcomes: readonly ToolOutcome[]): string {
  let block = "";
  if (memory) block += `\n\nRelevant things you remember:\n${memory}`;
  if (outcomes.length > 0) {
    block +=
      "\n\nYou just ran these tools. Use their results to answer the user's question in your own" +
      " words — do NOT repeat the raw tool output or JSON, and do not mention the tool names.";
    for (const o of outcomes) {
      const data = typeof o.data === "string" ? o.data : JSON.stringify(o.data);
      block += `\n<result tool="${o.tool}"${o.ok ? "" : ' status="failed"'}>\n${(data ?? o.summary).slice(0, 4000)}\n</result>`;
    }
  }
  return block;
}

function step(node: PlanNodeKind, label: string): PlanEvent {
  return { type: "step", step: { node, label, startedAt: 0, durationMs: 0 } };
}
