# ADR-0003 — Retrieval-first memory, not context-stuffing

Status: Accepted
Date: 2026-07-07

## Context
Memory is Socius's defining feature. The 4 GB model has a small context window, so injecting all
memory into every prompt is both impossible and counterproductive. Memory must be inspectable,
editable, timestamped, and provenance-tracked.

## Decision
Store all memory kinds as rows (one `kind`-discriminated table) in SQLite with embeddings in a
`sqlite-vec` virtual table and content in FTS5. Retrieve per query with a deterministic pipeline:
embed → vector KNN candidates → hybrid keyword → rerank (similarity × recency × confidence) →
fit to a token budget → inject. Never inject everything.

## Alternatives considered
1. Full conversation/memory history in the prompt.
2. A fine-tuned/personalized model carrying "memory" in weights.
3. A lossy rolling summary as the only long-term memory.

## Tradeoffs
Retrieval adds moving parts (embedder, vector index, rerank) and can miss context if embeddings
are weak — mitigated by the hybrid keyword pass and tunable `k`. Gained: small fast prompts,
inspectable "why this answer," and memory decoupled from any specific model.

## Long-term implications
Memory is portable data you own and can edit, independent of the model. Knowledge-base indexing
reuses the same pipeline. Scale is handled by bounded retrieval + pruning, not bigger prompts.

## Why the alternatives were rejected
1. Hard context limits make full-history injection infeasible, and it drowns signal even when it
   fits.
2. Weights are opaque, un-portable, and tie memory to one model — violates Principles #5 and #6.
3. A rolling summary silently forgets and can't be inspected or corrected by the user.
