/**
 * The single SQLite database: bun:sqlite + sqlite-vec (vector KNN) + FTS5
 * (keyword). WAL mode, single-writer (the daemon). The vector table's dimension
 * is set from the configured embedder; if it changes, embeddings are cleared and
 * must be rebuilt (they are derived data — see 11-storage.md).
 */
import { Database as BunDatabase } from "bun:sqlite";
import { type Result, error, ok } from "@socius/core";
import * as sqliteVec from "sqlite-vec";
import { MIGRATIONS } from "./migrations.ts";

export class SociusDatabase {
  private constructor(
    readonly db: BunDatabase,
    readonly embeddingDim: number,
  ) {}

  static async open(path: string, embeddingDim: number): Promise<Result<SociusDatabase>> {
    try {
      const db = new BunDatabase(path, { create: true });
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA foreign_keys = ON;");
      db.exec("PRAGMA busy_timeout = 5000;");
      sqliteVec.load(db);

      const instance = new SociusDatabase(db, embeddingDim);
      instance.migrate();
      instance.ensureVectorTable(embeddingDim);
      return ok(instance);
    } catch (cause) {
      return {
        ok: false,
        error: error("STORAGE_FAILED", "storage", "failed to open database", { cause }),
      };
    }
  }

  private migrate(): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);",
    );
    const applied = new Set(
      this.db
        .query("SELECT version FROM schema_migrations")
        .all()
        .map((r) => (r as { version: number }).version),
    );
    const pending = MIGRATIONS.filter((m) => !applied.has(m.version)).sort(
      (a, b) => a.version - b.version,
    );
    if (pending.length === 0) return;

    const tx = this.db.transaction(() => {
      for (const m of pending) {
        this.db.exec(m.up);
        this.db
          .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
          .run(m.version, m.name, Date.now());
      }
    });
    try {
      tx();
    } catch (cause) {
      throw error("MIGRATION_FAILED", "storage", "migration failed (rolled back)", { cause });
    }
  }

  /**
   * The vec0 table dimension is fixed at creation. If the configured embedder's
   * dimension differs from what the DB was built with, drop and recreate the
   * (derived, rebuildable) embeddings so the schema matches the embedder.
   */
  private ensureVectorTable(dim: number): void {
    const row = this.db.query("SELECT value FROM meta WHERE key = 'embedding_dim'").get() as
      | { value: string }
      | undefined;
    const current = row ? Number(row.value) : null;

    if (current === dim) return;
    if (current !== null) {
      // dimension changed — clear derived embeddings; memory rows are kept.
      this.db.exec("DROP TABLE IF EXISTS vec_memories;");
    }
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(embedding float[${dim}]);`,
    );
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('embedding_dim', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(String(dim));
  }

  close(): void {
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // best-effort
    }
    this.db.close();
  }
}
