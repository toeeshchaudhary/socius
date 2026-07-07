/**
 * The llama.cpp HTTP adapter implementing `InferenceBackend`. Talks to a running
 * `llama-server` over its OpenAI-compatible endpoint, which applies the model's
 * chat template for us (important for Gemma's turn formatting).
 */
import type {
  BackendHealth,
  CompletionChunk,
  CompletionRequest,
  InferenceBackend,
  Result,
} from "@socius/core";
import { error, ok } from "@socius/core";

export interface LlamaCppBackendOptions {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly contextWindow: number;
  /** Enable the model's chain-of-thought. Default false (direct answers). */
  readonly thinking?: boolean;
}

export class LlamaCppBackend implements InferenceBackend {
  readonly id = "llama.cpp";
  constructor(private readonly opts: LlamaCppBackendOptions) {}

  async *complete(req: CompletionRequest): AsyncIterable<CompletionChunk> {
    const body: Record<string, unknown> = {
      messages: req.messages,
      stream: true,
      temperature: req.temperature ?? 0.7,
      // Reasoning models otherwise burn the whole budget "thinking" and return
      // empty content; disable unless explicitly enabled.
      chat_template_kwargs: { enable_thinking: this.opts.thinking ?? false },
    };
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.stop !== undefined) body.stop = req.stop;
    if (req.responseSchema !== undefined) {
      body.response_format = { type: "json_schema", json_schema: { schema: req.responseSchema } };
    }

    const res = await fetch(`${this.opts.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    if (!res.ok || !res.body) {
      throw error("BACKEND_UNAVAILABLE", "inference", `llama-server returned ${res.status}`);
    }

    // Parse the SSE stream: lines of `data: {json}` terminated by `data: [DONE]`.
    // Use an explicit reader (async-iterating a ReadableStream is unreliable in
    // Bun and drops chunks); read() in a loop is the portable, correct way.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            yield { type: "done", text: "" };
            return;
          }
          const token = extractDelta(payload);
          if (token) yield { type: "token", text: token };
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: "done", text: "" };
  }

  async countTokens(text: string): Promise<Result<number>> {
    try {
      const res = await fetch(`${this.opts.baseUrl}/tokenize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok)
        return {
          ok: false,
          error: error("BACKEND_UNAVAILABLE", "inference", `tokenize ${res.status}`),
        };
      const json = (await res.json()) as { tokens?: unknown[] };
      return ok(Array.isArray(json.tokens) ? json.tokens.length : 0);
    } catch (cause) {
      return {
        ok: false,
        error: error("BACKEND_UNAVAILABLE", "inference", "tokenize failed", { cause }),
      };
    }
  }

  contextWindow(): number {
    return this.opts.contextWindow;
  }

  async health(): Promise<BackendHealth> {
    try {
      const res = await fetch(`${this.opts.baseUrl}/health`);
      return {
        healthy: res.ok,
        modelId: this.opts.modelId,
        contextWindow: this.opts.contextWindow,
      };
    } catch {
      return {
        healthy: false,
        modelId: this.opts.modelId,
        contextWindow: this.opts.contextWindow,
        detail: "unreachable",
      };
    }
  }
}

function extractDelta(payload: string): string | undefined {
  try {
    const obj = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
    return obj.choices?.[0]?.delta?.content;
  } catch {
    return undefined;
  }
}
