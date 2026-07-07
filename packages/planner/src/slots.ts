/**
 * LLM slot helpers. A "slot" is a single narrow question put to the model:
 *  - completeStructured: constrained JSON (schema-guided), consumed in full and
 *    parsed. Returns null on invalid output — the graph degrades, never crashes.
 *  - streamAnswer: the free-text streaming answer slot.
 */
import type { ChatMessage, InferenceBackend } from "@socius/core";

export async function completeStructured<T>(
  backend: InferenceBackend,
  messages: readonly ChatMessage[],
  schema: unknown,
  signal?: AbortSignal,
): Promise<T | null> {
  let raw = "";
  for await (const chunk of backend.complete({
    messages,
    responseSchema: schema,
    temperature: 0,
    maxTokens: 512,
    ...(signal ? { signal } : {}),
  })) {
    if (chunk.type === "token") raw += chunk.text;
  }
  return parseJson<T>(raw);
}

export interface AnswerParams {
  readonly system: string;
  readonly input: string;
  readonly stdin?: string;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
}

export async function* streamAnswer(backend: InferenceBackend, p: AnswerParams): AsyncIterable<string> {
  const userContent = p.stdin ? `${p.input}\n\n---\n${p.stdin}` : p.input;
  for await (const chunk of backend.complete({
    messages: [
      { role: "system", content: p.system },
      { role: "user", content: userContent },
    ],
    ...(p.maxTokens ? { maxTokens: p.maxTokens } : {}),
    ...(p.signal ? { signal: p.signal } : {}),
  })) {
    if (chunk.type === "token") yield chunk.text;
  }
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
