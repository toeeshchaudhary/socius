/**
 * Forward-only, numbered migrations. Applied at startup inside a transaction;
 * a failure rolls back and aborts (never a half-migrated DB). The vector table
 * is created separately (see database.ts) because its dimension depends on the
 * configured embedder, not on a static schema.
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial",
    up: `
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE memories (
        rowid        INTEGER PRIMARY KEY,
        id           TEXT NOT NULL UNIQUE,
        kind         TEXT NOT NULL,
        content      TEXT NOT NULL,
        source_origin TEXT NOT NULL,
        source_ref   TEXT,
        confidence   REAL NOT NULL DEFAULT 0.7,
        tags         TEXT NOT NULL DEFAULT '[]',
        metadata     TEXT NOT NULL DEFAULT '{}',
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        accessed_at  INTEGER NOT NULL
      );
      CREATE INDEX idx_memories_kind ON memories(kind);
      CREATE INDEX idx_memories_accessed ON memories(accessed_at);

      CREATE VIRTUAL TABLE fts_memories USING fts5(content);
    `,
  },
];
