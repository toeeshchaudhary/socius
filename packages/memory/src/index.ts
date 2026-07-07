/**
 * @socius/memory — the retrieval-first memory subsystem (M2).
 * Pipeline: embed → sqlite-vec KNN candidates → hybrid FTS5 → rerank
 * (similarity × recency × confidence) → fit-to-token-budget → inject.
 */
export { SqliteMemoryStore, type MemoryRankingConfig } from "./store.ts";
