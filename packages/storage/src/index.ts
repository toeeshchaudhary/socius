/**
 * @socius/storage — the single SQLite database (bun:sqlite) with sqlite-vec for
 * vector KNN and FTS5 for keyword search. Owns migrations and low-level
 * repositories. The DB is a *cache/index*; Markdown knowledge is canonical and
 * the DB is rebuildable from disk.
 *
 * M1 wires bun:sqlite + migrations; this stub defines the surface.
 */
import { type Result, type SociusError, error } from "@socius/core";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
}

export interface Database {
  migrate(): Promise<Result<void>>;
  close(): void;
}

const notImplemented = (what: string): SociusError =>
  error("NOT_IMPLEMENTED", "storage", `${what} is not implemented yet (M1/M2).`);

export async function openDatabase(_path: string): Promise<Result<Database>> {
  return { ok: false, error: notImplemented("openDatabase") };
}
