/**
 * Embedders. Two implementations behind the same `Embedder` interface:
 *
 *  - LlamaCppEmbedder: real semantic embeddings from a CPU llama-server started
 *    in --embeddings mode with a small embedding GGUF (bge-small class).
 *  - HashingEmbedder: a deterministic, model-free fallback (character-trigram
 *    hashing). Not semantic, but keeps memory fully functional with no extra
 *    model, and pairs with FTS5 keyword search for useful lexical recall until
 *    an embedding model is configured.
 */
import type { BackendHealth, Embedder, Result } from "@socius/core";
import { error, ok } from "@socius/core";

export interface LlamaCppEmbedderOptions {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly dimensions: number;
}

export class LlamaCppEmbedder implements Embedder {
  readonly id = "llama.cpp-embed";
  readonly dimensions: number;
  constructor(private readonly opts: LlamaCppEmbedderOptions) {
    this.dimensions = opts.dimensions;
  }

  async embed(texts: readonly string[]): Promise<Result<readonly Float32Array[]>> {
    try {
      const res = await fetch(`${this.opts.baseUrl}/v1/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: texts, model: this.opts.modelId }),
      });
      if (!res.ok) {
        return { ok: false, error: error("BACKEND_UNAVAILABLE", "inference", `embeddings ${res.status}`) };
      }
      const json = (await res.json()) as { data?: { embedding: number[] }[] };
      const vecs = (json.data ?? []).map((d) => Float32Array.from(d.embedding));
      return ok(vecs);
    } catch (cause) {
      return { ok: false, error: error("BACKEND_UNAVAILABLE", "inference", "embeddings failed", { cause }) };
    }
  }

  async health(): Promise<BackendHealth> {
    try {
      const res = await fetch(`${this.opts.baseUrl}/health`);
      return { healthy: res.ok, modelId: this.opts.modelId, contextWindow: 0 };
    } catch {
      return { healthy: false, modelId: this.opts.modelId, contextWindow: 0, detail: "unreachable" };
    }
  }
}

/**
 * Model-free deterministic embedder. Hashes character trigrams into a fixed-size
 * vector. Captures surface/lexical similarity only — swap for LlamaCppEmbedder
 * (or another model) for true semantic retrieval.
 */
export class HashingEmbedder implements Embedder {
  readonly id = "hashing";
  readonly dimensions: number;
  constructor(dimensions = 256) {
    this.dimensions = dimensions;
  }

  async embed(texts: readonly string[]): Promise<Result<readonly Float32Array[]>> {
    return ok(texts.map((t) => this.vec(t)));
  }

  private vec(text: string): Float32Array {
    const v = new Float32Array(this.dimensions);
    const s = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    for (let i = 0; i < s.length - 2; i++) {
      const tri = s.slice(i, i + 3);
      const idx = hash(tri) % this.dimensions;
      v[idx] = (v[idx] ?? 0) + 1;
    }
    return v; // normalization happens in the memory store
  }

  async health(): Promise<BackendHealth> {
    return { healthy: true, modelId: this.id, contextWindow: 0 };
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
