# 11 — Storage

One database, one file, no server: **SQLite** via Bun's built-in `bun:sqlite`, extended with
`sqlite-vec` for vector KNN and FTS5 for keyword search. Reference: `packages/storage/`.

## Why SQLite (and nothing else)

Single-user, local-first, no telemetry — the requirements *are* SQLite's sweet spot.

- **Why:** zero-config, zero-server, a single portable file the user owns and can back up by
  copying. Transactional. Fast enough for one user by orders of magnitude. `bun:sqlite` is
  built-in, so no native addon to compile.
- **Alternatives:** Postgres (explicitly rejected by the brief — a server, an account surface, a
  daemon to run for a single-user tool); a document store; flat files for structured state.
- **Rejected Postgres/servers** because running a database server for one local user violates
  local-first simplicity and adds an always-on process and a network surface for no benefit.

## What lives where

- **Canonical, human-owned:** Markdown knowledge base ([`05-knowledge.md`](./05-knowledge.md)).
- **Canonical, structured:** memory rows, goals, preferences, workflows, conversation logs — in
  SQLite. These have no better on-disk representation and are Socius-native.
- **Derived / rebuildable:** embeddings (`sqlite-vec` virtual table) and FTS5 indexes. These can
  be regenerated from the canonical data, so corruption or a schema bump is recoverable.

```
socius.db
  memories        (id, kind, content, source_origin, source_ref, confidence,
                   tags, metadata, created_at, updated_at, accessed_at)
  vec_memories    sqlite-vec virtual table (memory_id → embedding)
  fts_memories    FTS5 over memories.content
  goals, preferences, workflows, ...
  schema_migrations (version, name, applied_at)
```

## Migrations

Schema changes are **versioned, forward-only migrations** applied at daemon startup inside a
transaction. Each migration has an integer `version`, a `name`, and its SQL. The applied set is
recorded in `schema_migrations`. A failed migration rolls back and aborts startup with
`MIGRATION_FAILED` rather than leaving a half-migrated database — the daemon refuses to run on a
schema it does not understand.

Migration versioning is coordinated with the app's data-schema version
([`16-versioning.md`](./16-versioning.md)).

## Concurrency

The daemon is the **only writer** (single process owns the DB). WAL mode is enabled for good read
concurrency and durability. Because writes funnel through one process, there is no multi-writer
contention to design around — a direct benefit of the daemon architecture
([`02-process-model.md`](./02-process-model.md)).

## Backup and portability

Backup is `cp socius.db socius.db.bak` (or copy the WAL too, or run `VACUUM INTO`). The whole of
Socius's structured state is one file plus the knowledge folder. `socius export` (M2+) will bundle
both into a portable archive. There is no cloud, no account, nothing to extract from a
third party — Principle #1.
