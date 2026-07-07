/**
 * SqliteMemoryStore — the retrieval-first memory subsystem.
 *
 * Pipeline (retrieve): embed query → sqlite-vec KNN candidates + FTS5 keyword
 * candidates → merge → rerank (similarity × recency × confidence) → fit to a
 * token budget. Never dumps all memory into a prompt.
 */
import type {
  Embedder,
  Memory,
  MemoryDraft,
  MemoryId,
  MemoryKind,
  MemoryStore,
  Result,
  RetrievalQuery,
  RetrievedMemory,
} from "@socius/core";
import { asMemoryId, error, ok } from "@socius/core";
import { type SociusDatabase, packVector } from "@socius/storage";

export interface MemoryRankingConfig {
  readonly confidenceHalfLifeDays: number;
  readonly defaultK: number;
  readonly defaultTokenBudget: number;
  /** Baseline similarity granted to a pure keyword (FTS) hit. */
  readonly keywordBaseline: number;
}

const DEFAULT_RANKING: MemoryRankingConfig = {
  confidenceHalfLifeDays: 30,
  defaultK: 12,
  defaultTokenBudget: 1024,
  keywordBaseline: 0.5,
};

interface MemoryRow {
  rowid: number;
  id: string;
  kind: string;
  content: string;
  source_origin: string;
  source_ref: string | null;
  confidence: number;
  tags: string;
  metadata: string;
  created_at: number;
  updated_at: number;
  accessed_at: number;
}

export class SqliteMemoryStore implements MemoryStore {
  private readonly cfg: MemoryRankingConfig;

  constructor(
    private readonly store: SociusDatabase,
    private readonly embedder: Embedder,
    cfg?: Partial<MemoryRankingConfig>,
  ) {
    this.cfg = { ...DEFAULT_RANKING, ...cfg };
  }

  private get db() {
    return this.store.db;
  }

  async remember(draft: MemoryDraft): Promise<Result<Memory>> {
    const now = Date.now();
    const id = crypto.randomUUID();
    const memory: Memory = {
      id: asMemoryId(id),
      kind: draft.kind,
      content: draft.content,
      source: draft.source,
      confidence: draft.confidence ?? 0.7,
      tags: draft.tags ?? [],
      metadata: draft.metadata ?? {},
      createdAt: now as Memory["createdAt"],
      updatedAt: now as Memory["updatedAt"],
      accessedAt: now as Memory["accessedAt"],
    };

    const emb = await this.embed(draft.content);
    if (!emb.ok) return emb;

    try {
      const tx = this.db.transaction(() => {
        const info = this.db
          .prepare(
            `INSERT INTO memories (id, kind, content, source_origin, source_ref, confidence, tags, metadata, created_at, updated_at, accessed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            memory.kind,
            memory.content,
            memory.source.origin,
            memory.source.ref ?? null,
            memory.confidence,
            JSON.stringify(memory.tags),
            JSON.stringify(memory.metadata),
            now,
            now,
            now,
          );
        const rowid = Number(info.lastInsertRowid);
        this.db
          .prepare("INSERT INTO vec_memories (rowid, embedding) VALUES (?, ?)")
          .run(rowid, packVector(emb.value));
        this.db
          .prepare("INSERT INTO fts_memories (rowid, content) VALUES (?, ?)")
          .run(rowid, memory.content);
      });
      tx();
      return ok(memory);
    } catch (cause) {
      return {
        ok: false,
        error: error("STORAGE_FAILED", "memory", "failed to store memory", { cause }),
      };
    }
  }

  async get(id: MemoryId): Promise<Result<Memory | null>> {
    const row = this.db.query("SELECT * FROM memories WHERE id = ?").get(id) as
      | MemoryRow
      | undefined;
    return ok(row ? this.toMemory(row) : null);
  }

  async update(id: MemoryId, patch: Partial<MemoryDraft>): Promise<Result<Memory>> {
    const existing = this.db.query("SELECT * FROM memories WHERE id = ?").get(id) as
      | MemoryRow
      | undefined;
    if (!existing)
      return { ok: false, error: error("STORAGE_FAILED", "memory", `no memory ${id}`) };
    const now = Date.now();
    const content = patch.content ?? existing.content;
    const confidence = patch.confidence ?? existing.confidence;
    const tags = patch.tags ? JSON.stringify(patch.tags) : existing.tags;
    const metadata = patch.metadata ? JSON.stringify(patch.metadata) : existing.metadata;

    try {
      const contentChanged = patch.content !== undefined && patch.content !== existing.content;
      let newEmb: Float32Array | null = null;
      if (contentChanged) {
        const e = await this.embed(content);
        if (!e.ok) return e;
        newEmb = e.value;
      }
      const tx = this.db.transaction(() => {
        this.db
          .prepare(
            "UPDATE memories SET content=?, confidence=?, tags=?, metadata=?, updated_at=? WHERE id=?",
          )
          .run(content, confidence, tags, metadata, now, id);
        if (newEmb) {
          this.db
            .prepare("UPDATE vec_memories SET embedding=? WHERE rowid=?")
            .run(packVector(newEmb), existing.rowid);
          this.db
            .prepare("UPDATE fts_memories SET content=? WHERE rowid=?")
            .run(content, existing.rowid);
        }
      });
      tx();
      const updated = this.db.query("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow;
      return ok(this.toMemory(updated));
    } catch (cause) {
      return {
        ok: false,
        error: error("STORAGE_FAILED", "memory", "failed to update memory", { cause }),
      };
    }
  }

  async forget(id: MemoryId): Promise<Result<void>> {
    const row = this.db.query("SELECT rowid FROM memories WHERE id = ?").get(id) as
      | { rowid: number }
      | undefined;
    if (!row) return ok(undefined);
    try {
      const tx = this.db.transaction(() => {
        this.db.prepare("DELETE FROM memories WHERE rowid = ?").run(row.rowid);
        this.db.prepare("DELETE FROM vec_memories WHERE rowid = ?").run(row.rowid);
        this.db.prepare("DELETE FROM fts_memories WHERE rowid = ?").run(row.rowid);
      });
      tx();
      return ok(undefined);
    } catch (cause) {
      return {
        ok: false,
        error: error("STORAGE_FAILED", "memory", "failed to forget memory", { cause }),
      };
    }
  }

  async retrieve(query: RetrievalQuery): Promise<Result<readonly RetrievedMemory[]>> {
    const k = query.k ?? this.cfg.defaultK;
    const budget = query.tokenBudget ?? this.cfg.defaultTokenBudget;

    const emb = await this.embed(query.text);
    if (!emb.ok) return emb;

    // similarity per rowid (max over vector + keyword signals)
    const sims = new Map<number, number>();

    for (const r of this.vectorCandidates(emb.value, k)) {
      sims.set(r.rowid, Math.max(sims.get(r.rowid) ?? 0, r.similarity));
    }
    for (const rowid of this.keywordCandidates(query.text, k)) {
      sims.set(rowid, Math.max(sims.get(rowid) ?? 0, this.cfg.keywordBaseline));
    }
    if (sims.size === 0) return ok([]);

    const kindFilter = query.kinds ? new Set(query.kinds) : null;
    const now = Date.now();
    const scored: RetrievedMemory[] = [];
    for (const [rowid, similarity] of sims) {
      const row = this.db.query("SELECT * FROM memories WHERE rowid = ?").get(rowid) as
        | MemoryRow
        | undefined;
      if (!row) continue;
      if (kindFilter && !kindFilter.has(row.kind as MemoryKind)) continue;
      const memory = this.toMemory(row);
      const recency = this.recencyDecay(now - row.updated_at);
      const score = similarity * recency * memory.confidence;
      scored.push({ memory, similarity, score });
    }
    scored.sort((a, b) => b.score - a.score);

    // fit to token budget
    const out: RetrievedMemory[] = [];
    let used = 0;
    for (const item of scored) {
      const cost = Math.ceil(item.memory.content.length / 4);
      if (used + cost > budget && out.length > 0) break;
      out.push(item);
      used += cost;
    }
    // mark accessed
    if (out.length > 0) {
      const ids = out.map((r) => r.memory.id);
      const stmt = this.db.prepare("UPDATE memories SET accessed_at = ? WHERE id = ?");
      for (const id of ids) stmt.run(now, id);
    }
    return ok(out);
  }

  async list(filter?: { kinds?: readonly MemoryKind[]; limit?: number }): Promise<
    Result<readonly Memory[]>
  > {
    const limit = filter?.limit ?? 100;
    let rows: MemoryRow[];
    if (filter?.kinds && filter.kinds.length > 0) {
      const placeholders = filter.kinds.map(() => "?").join(",");
      rows = this.db
        .query(
          `SELECT * FROM memories WHERE kind IN (${placeholders}) ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(...filter.kinds, limit) as MemoryRow[];
    } else {
      rows = this.db
        .query("SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?")
        .all(limit) as MemoryRow[];
    }
    return ok(rows.map((r) => this.toMemory(r)));
  }

  // ---- internals ----

  private async embed(text: string): Promise<Result<Float32Array>> {
    const r = await this.embedder.embed([text]);
    if (!r.ok) return r;
    const v = r.value[0];
    if (!v)
      return {
        ok: false,
        error: error("BACKEND_UNAVAILABLE", "memory", "embedder returned no vector"),
      };
    return ok(normalize(v));
  }

  private vectorCandidates(vec: Float32Array, k: number): { rowid: number; similarity: number }[] {
    const rows = this.db
      .query(
        "SELECT rowid, distance FROM vec_memories WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
      )
      .all(packVector(vec), k) as { rowid: number; distance: number }[];
    // normalized vectors: cosine = 1 - d^2/2
    return rows.map((r) => ({
      rowid: r.rowid,
      similarity: Math.max(0, 1 - (r.distance * r.distance) / 2),
    }));
  }

  private keywordCandidates(text: string, k: number): number[] {
    const terms = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1);
    if (terms.length === 0) return [];
    const match = terms.map((t) => `"${t}"`).join(" OR ");
    try {
      const rows = this.db
        .query(
          "SELECT rowid FROM fts_memories WHERE fts_memories MATCH ? ORDER BY bm25(fts_memories) LIMIT ?",
        )
        .all(match, k) as { rowid: number }[];
      return rows.map((r) => r.rowid);
    } catch {
      return [];
    }
  }

  private recencyDecay(ageMs: number): number {
    const ageDays = ageMs / 86_400_000;
    return 0.5 ** (ageDays / this.cfg.confidenceHalfLifeDays);
  }

  private toMemory(row: MemoryRow): Memory {
    return {
      id: asMemoryId(row.id),
      kind: row.kind as MemoryKind,
      content: row.content,
      source: { origin: row.source_origin, ...(row.source_ref ? { ref: row.source_ref } : {}) },
      confidence: row.confidence,
      tags: JSON.parse(row.tags) as string[],
      metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      createdAt: row.created_at as Memory["createdAt"],
      updatedAt: row.updated_at as Memory["updatedAt"],
      accessedAt: row.accessed_at as Memory["accessedAt"],
    };
  }
}

function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm;
  return out;
}
