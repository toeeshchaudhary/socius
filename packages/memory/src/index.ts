/**
 * @socius/memory — the retrieval-first memory subsystem (M2).
 * Pipeline: embed → sqlite-vec KNN candidates → hybrid FTS5 → rerank
 * (similarity × recency × confidence) → fit-to-token-budget → inject.
 */
import type { MemoryDraft, MemoryId, MemoryStore, Result, RetrievalQuery } from "@socius/core";
import { error } from "@socius/core";

const todo = (what: string) => ({
  ok: false as const,
  error: error("NOT_IMPLEMENTED", "memory", `${what} (M2).`),
});

export class SqliteMemoryStore implements MemoryStore {
  async remember(_d: MemoryDraft): Promise<Result<never>> {
    return todo("remember");
  }
  async get(_id: MemoryId): Promise<Result<never>> {
    return todo("get");
  }
  async update(_id: MemoryId, _p: Partial<MemoryDraft>): Promise<Result<never>> {
    return todo("update");
  }
  async forget(_id: MemoryId): Promise<Result<never>> {
    return todo("forget");
  }
  async retrieve(_q: RetrievalQuery): Promise<Result<never>> {
    return todo("retrieve");
  }
  async list(): Promise<Result<never>> {
    return todo("list");
  }
}
