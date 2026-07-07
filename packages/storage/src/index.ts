/**
 * @socius/storage — the single SQLite database (bun:sqlite) with sqlite-vec for
 * vector KNN and FTS5 for keyword search. Owns migrations. The DB is a
 * cache/index over canonical data (Markdown knowledge is the source of truth).
 */
export { SociusDatabase } from "./database.ts";
export { MIGRATIONS, type Migration } from "./migrations.ts";

/** Pack a normalized embedding for sqlite-vec storage/query. */
export function packVector(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}
