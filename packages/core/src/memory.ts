/**
 * The Memory contract. Memory is NOT conversation history — it is the defining
 * subsystem of Socius. Every memory is inspectable, editable, timestamped, and
 * carries provenance and a confidence score.
 *
 * All kinds share one row shape (a `kind` discriminant), not one table per kind:
 * this keeps retrieval uniform and lets new kinds be added without schema churn.
 */
import type { MemoryId, Timestamp } from "./ids.ts";
import type { Result } from "./result.ts";

export type MemoryKind =
  | "conversation"
  | "working"
  | "project"
  | "long_term"
  | "journal"
  | "knowledge"
  | "architecture_decision"
  | "preference"
  | "goal"
  | "workflow";

export interface MemorySource {
  /** Where this memory came from: "chat", "file:...", "tool:git", "user", ... */
  readonly origin: string;
  /** Optional path/URL/id for traceability back to the canonical artifact. */
  readonly ref?: string;
}

export interface Memory {
  readonly id: MemoryId;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly source: MemorySource;
  /** 0..1 — how much Socius trusts this memory. Decays / is reinforced over time. */
  readonly confidence: number;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly accessedAt: Timestamp;
}

export interface MemoryDraft {
  readonly kind: MemoryKind;
  readonly content: string;
  readonly source: MemorySource;
  readonly confidence?: number;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RetrievalQuery {
  readonly text: string;
  readonly kinds?: readonly MemoryKind[];
  readonly tags?: readonly string[];
  /** Candidate pool size for the vector search before reranking. */
  readonly k?: number;
  /** Hard ceiling on how many tokens of memory may be injected. */
  readonly tokenBudget?: number;
}

export interface RetrievedMemory {
  readonly memory: Memory;
  readonly similarity: number;
  /** Final blended score (similarity × recency × confidence). */
  readonly score: number;
}

/**
 * Retrieval-first: query → embed → vector candidates → (hybrid keyword) →
 * rerank → fit-to-token-budget. Never dumps all memory into the prompt.
 */
export interface MemoryStore {
  remember(draft: MemoryDraft): Promise<Result<Memory>>;
  get(id: MemoryId): Promise<Result<Memory | null>>;
  update(id: MemoryId, patch: Partial<MemoryDraft>): Promise<Result<Memory>>;
  forget(id: MemoryId): Promise<Result<void>>;
  retrieve(query: RetrievalQuery): Promise<Result<readonly RetrievedMemory[]>>;
  /** List for inspection tooling (`socius mem`). */
  list(filter?: { kinds?: readonly MemoryKind[]; limit?: number }): Promise<
    Result<readonly Memory[]>
  >;
}
