/**
 * LLM slot helpers. A "slot" is a single narrow question put to the model:
 *  - completeStructured: constrained JSON (schema-guided), consumed in full and
 *    parsed. Returns null on invalid output — the graph degrades, never crashes.
 *  - streamAnswer: the free-text streaming answer slot.
 *
 * Both optionally record a ReasoningTrace (prompt, raw output, validated output,
 * latency) so `socius trace` can replay exactly what the model saw and decided.
 */
import type { ChatMessage, InferenceBackend, TraceId, TraceSink } from "@socius/core";

export interface TraceContext {
  readonly sink: TraceSink;
  readonly traceId: TraceId;
  readonly slot: string;
}

function promptText(messages: readonly ChatMessage[]): string {
  return messages.map((m) => `[${m.role}] ${m.content}`).join("\n");
}

export async function completeStructured<T>(
  backend: InferenceBackend,
  messages: readonly ChatMessage[],
  schema: unknown,
  opts: { signal?: AbortSignal; trace?: TraceContext } = {},
): Promise<T | null> {
  const started = performance.now();
  let raw = "";
  for await (const chunk of backend.complete({
    messages,
    responseSchema: schema,
    temperature: 0,
    maxTokens: 512,
    ...(opts.signal ? { signal: opts.signal } : {}),
  })) {
    if (chunk.type === "token") raw += chunk.text;
  }
  const parsed = parseJson<T>(raw);
  opts.trace?.sink.record({
    traceId: opts.trace.traceId,
    slot: opts.trace.slot,
    prompt: promptText(messages),
    rawOutput: raw,
    validatedOutput: parsed ?? undefined,
    valid: parsed !== null,
    latencyMs: Math.round(performance.now() - started),
  });
  return parsed;
}

export interface AnswerParams {
  readonly system: string;
  readonly input: string;
  readonly stdin?: string;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
  readonly trace?: TraceContext;
}

export async function* streamAnswer(
  backend: InferenceBackend,
  p: AnswerParams,
): AsyncIterable<string> {
  const userContent = p.stdin ? `${p.input}\n\n---\n${p.stdin}` : p.input;
  const messages: ChatMessage[] = [
    { role: "system", content: p.system },
    { role: "user", content: userContent },
  ];
  const started = performance.now();
  let full = "";
  for await (const chunk of backend.complete({
    messages,
    ...(p.maxTokens ? { maxTokens: p.maxTokens } : {}),
    ...(p.signal ? { signal: p.signal } : {}),
  })) {
    if (chunk.type === "token") {
      full += chunk.text;
      yield chunk.text;
    }
  }
  p.trace?.sink.record({
    traceId: p.trace.traceId,
    slot: p.trace.slot,
    prompt: promptText(messages),
    rawOutput: full,
    valid: true,
    latencyMs: Math.round(performance.now() - started),
  });
}

/** Extract and parse the first JSON object/array in a string. Tolerant of prose around it. */
export function parseJson<T>(raw: string): T | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through to brace extraction
  }
  const start = trimmed.search(/[[{]/);
  if (start === -1) return null;
  const open = trimmed[start];
  const close = open === "{" ? "}" : "]";
  const end = trimmed.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
