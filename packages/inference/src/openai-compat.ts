/**
 * OpenAI-compatible remote adapter implementing `InferenceBackend`. Covers any
 * gateway or provider that speaks `/chat/completions` — Vercel AI Gateway,
 * OpenRouter, Groq, Google AI Studio, Cerebras, or a custom baseUrl. The daemon
 * picks this over llama-server when `inference.backend = "remote"`.
 */
import type {
  BackendHealth,
  CompletionChunk,
  CompletionRequest,
  InferenceBackend,
  Result,
} from "@socius/core";
import { error, ok } from "@socius/core";

export interface GatewayPreset {
  readonly baseUrl: string;
  /** Conventional env var for the key, used in hints/docs. */
  readonly keyEnv: string;
  /** Human note surfaced by `socius doctor`/docs (e.g. free-tier availability). */
  readonly note: string;
  /**
   * Path (relative to baseUrl) that actually requires auth, for key validation.
   * Defaults to "/models" — but some gateways serve that publicly (OpenRouter),
   * so a preset can point at an authenticated endpoint instead.
   */
  readonly keyCheckPath?: string;
  /**
   * Extra request-body fields merged in when `inference.thinking` is false.
   * Reasoning models otherwise burn the whole token budget on chain-of-thought
   * (streamed as `reasoning`, not `content`) and return empty answers — fatal
   * for the planner's structured slots.
   */
  readonly noThinkBody?: Readonly<Record<string, unknown>>;
}

/**
 * Built-in gateway presets. Gateways marked free have a no-cost tier as of
 * 2026-07; "custom" (any baseUrl) is always available via config.
 */
export const GATEWAYS: Record<string, GatewayPreset> = {
  vercel: {
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    keyEnv: "AI_GATEWAY_API_KEY",
    note: "Vercel AI Gateway — one key, many providers; usage-billed with free credit",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    note: "OpenRouter — models with a ':free' suffix cost nothing (rate-limited)",
    // /models is public on OpenRouter; /key requires (and thus validates) auth.
    keyCheckPath: "/key",
    // `enabled: false` is ignored by some providers; a low effort cap reliably
    // leaves budget for actual content (verified against tencent/hy3:free).
    noThinkBody: { reasoning: { effort: "low" } },
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    note: "Groq — generous free tier, very fast open models",
  },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    note: "Google AI Studio — free tier for Gemini models",
  },
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1",
    keyEnv: "CEREBRAS_API_KEY",
    note: "Cerebras — free tier, fast open models",
  },
};

export type KeyCheckResult =
  | { readonly status: "valid" }
  | { readonly status: "invalid"; readonly detail: string }
  | { readonly status: "unreachable"; readonly detail: string };

/**
 * Live-check an API key against a gateway's authenticated endpoint. "invalid"
 * means the gateway rejected the key (401/403); "unreachable" means we couldn't
 * tell (offline, DNS, 5xx) — callers should treat that as inconclusive, not bad.
 */
export async function checkApiKey(
  baseUrl: string,
  apiKey: string,
  keyCheckPath = "/models",
): Promise<KeyCheckResult> {
  try {
    const res = await fetch(`${baseUrl}${keyCheckPath}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { status: "valid" };
    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      return { status: "invalid", detail: `${res.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }
    return { status: "unreachable", detail: `gateway returned ${res.status}` };
  } catch (cause) {
    return {
      status: "unreachable",
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export interface OpenAICompatBackendOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly modelId: string;
  readonly contextWindow: number;
  /** Mirrors `inference.thinking`; when false, `noThinkBody` is merged in. */
  readonly thinking?: boolean;
  readonly noThinkBody?: Readonly<Record<string, unknown>>;
}

export class OpenAICompatBackend implements InferenceBackend {
  readonly id = "openai-compat";
  constructor(private readonly opts: OpenAICompatBackendOptions) {}

  async *complete(req: CompletionRequest): AsyncIterable<CompletionChunk> {
    // Structured slots: response_format support varies wildly across gateways —
    // some 400 on it, and some providers ignore reasoning caps when it is set,
    // burning the whole budget on chain-of-thought and returning EMPTY content
    // (observed on OpenRouter free models). Slot prompts already demand JSON and
    // the planner's parseJson tolerates fenced/loose output, so falling back to
    // an unconstrained call is strictly better than an empty one. These calls
    // are small, so buffering (no streaming) is fine.
    if (req.responseSchema !== undefined) {
      // Reasoning models burn budget on chain-of-thought that does not count as
      // content — a slot's normal budget can produce `finish: length` with EMPTY
      // content. Escalate: schema → schema with 3× budget → unconstrained.
      const boosted = { ...req, maxTokens: (req.maxTokens ?? 512) * 3 };
      let text = await this.collectNonStreaming(req, true);
      if (!text.trim()) text = await this.collectNonStreaming(boosted, true);
      if (!text.trim()) text = await this.collectNonStreaming(boosted, false);
      if (text) yield { type: "token", text };
      yield { type: "done", text: "" };
      return;
    }

    const res = await this.post(req, true);
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw error(
        "BACKEND_UNAVAILABLE",
        "inference",
        `${this.opts.baseUrl} returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }

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
          // Gateways report provider failures (rate limits, model errors) as an
          // SSE error payload mid-stream; dropping it would look like an empty
          // answer. Surface it.
          const err = extractError(payload);
          if (err) throw error("BACKEND_UNAVAILABLE", "inference", `gateway error: ${err}`);
          const token = extractDelta(payload);
          if (token) yield { type: "token", text: token };
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: "done", text: "" };
  }

  /** One non-streaming completion; returns message content ("" on any failure worth retrying). */
  private async collectNonStreaming(req: CompletionRequest, withSchema: boolean): Promise<string> {
    const res = await this.post(req, withSchema, false);
    if (res.status === 400 && withSchema) return ""; // schema rejected → caller retries without
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw error(
        "BACKEND_UNAVAILABLE",
        "inference",
        `${this.opts.baseUrl} returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
    const json = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content ?? "";
  }

  private post(req: CompletionRequest, withSchema: boolean, stream = true): Promise<Response> {
    const body: Record<string, unknown> = {
      model: this.opts.modelId,
      messages: req.messages,
      stream,
      temperature: req.temperature ?? 0.7,
    };
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.stop !== undefined) body.stop = req.stop;
    if (this.opts.thinking === false && this.opts.noThinkBody) {
      Object.assign(body, this.opts.noThinkBody);
    }
    if (withSchema && req.responseSchema !== undefined) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "output", schema: req.responseSchema },
      };
    }
    return fetch(`${this.opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify(body),
      ...(req.signal ? { signal: req.signal } : {}),
    });
  }

  // Remote gateways expose no tokenizer endpoint; ~4 chars/token is close
  // enough for the budget arithmetic this feeds.
  async countTokens(text: string): Promise<Result<number>> {
    return ok(Math.ceil(text.length / 4));
  }

  contextWindow(): number {
    return this.opts.contextWindow;
  }

  async health(): Promise<BackendHealth> {
    try {
      const res = await fetch(`${this.opts.baseUrl}/models`, {
        headers: { authorization: `Bearer ${this.opts.apiKey}` },
      });
      return {
        healthy: res.ok,
        modelId: this.opts.modelId,
        contextWindow: this.opts.contextWindow,
        ...(res.ok ? {} : { detail: `models endpoint returned ${res.status}` }),
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

function extractError(payload: string): string | undefined {
  try {
    const obj = JSON.parse(payload) as { error?: { message?: string; code?: unknown } };
    if (!obj.error) return undefined;
    return obj.error.message ?? JSON.stringify(obj.error).slice(0, 200);
  } catch {
    return undefined;
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
