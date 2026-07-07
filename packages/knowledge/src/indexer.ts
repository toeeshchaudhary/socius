/**
 * Indexes the Markdown knowledge base into memory. Files are canonical; this
 * produces the derived, rebuildable index (knowledge-kind memories). A full
 * reindex clears prior knowledge memories and rebuilds — cheap and idempotent.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import matter from "gray-matter";
import type { MemoryStore, Result } from "@socius/core";
import { ok } from "@socius/core";

const MAX_CHUNK_CHARS = 600;

export interface IndexResult {
  readonly files: number;
  readonly chunks: number;
}

export async function indexKnowledge(dir: string, store: MemoryStore): Promise<Result<IndexResult>> {
  // Clear existing knowledge memories (derived data) for a clean rebuild.
  const existing = await store.list({ kinds: ["knowledge"], limit: 100_000 });
  if (existing.ok) {
    for (const m of existing.value) await store.forget(m.id);
  }

  const files = await walkMarkdown(dir);
  let chunkCount = 0;
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const parsed = matter(raw);
    const rel = relative(dir, file);
    const folder = rel.split("/")[0] ?? "";
    const title = (parsed.data.title as string | undefined) ?? rel;
    const tags = Array.isArray(parsed.data.tags) ? (parsed.data.tags as string[]).map(String) : [];

    for (const piece of splitIntoChunks(parsed.content)) {
      await store.remember({
        kind: "knowledge",
        content: piece,
        source: { origin: "file", ref: rel },
        tags,
        metadata: { title, folder },
      });
      chunkCount += 1;
    }
  }
  return ok({ files: files.length, chunks: chunkCount });
}

async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(d: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(d);
    } catch {
      return; // dir doesn't exist yet
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(d, name);
      const s = await stat(full);
      if (s.isDirectory()) await recurse(full);
      else if (extname(name).toLowerCase() === ".md") out.push(full);
    }
  }
  await recurse(dir);
  return out.sort();
}

/** Deterministic chunking: group paragraphs into ~MAX_CHUNK_CHARS windows. */
function splitIntoChunks(body: string): string[] {
  const paras = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur.length + p.length + 2 > MAX_CHUNK_CHARS && cur.length > 0) {
      chunks.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}
