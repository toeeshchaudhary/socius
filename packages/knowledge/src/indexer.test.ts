import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Memory,
  MemoryDraft,
  MemoryId,
  MemoryKind,
  MemoryStore,
  Result,
  RetrievalQuery,
  RetrievedMemory,
} from "@socius/core";
import { asMemoryId, ok, unwrap } from "@socius/core";
import { indexKnowledge } from "./indexer.ts";

/** Minimal in-memory MemoryStore so this test depends only on @socius/core. */
class FakeMemoryStore implements MemoryStore {
  private readonly rows = new Map<string, Memory>();
  private seq = 0;

  async remember(draft: MemoryDraft): Promise<Result<Memory>> {
    const id = asMemoryId(`m${++this.seq}`);
    const now = Date.now() as Memory["createdAt"];
    const m: Memory = {
      id,
      kind: draft.kind,
      content: draft.content,
      source: draft.source,
      confidence: draft.confidence ?? 0.7,
      tags: draft.tags ?? [],
      metadata: draft.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      accessedAt: now,
    };
    this.rows.set(id, m);
    return ok(m);
  }
  async get(id: MemoryId): Promise<Result<Memory | null>> {
    return ok(this.rows.get(id) ?? null);
  }
  async update(): Promise<Result<Memory>> {
    throw new Error("unused");
  }
  async forget(id: MemoryId): Promise<Result<void>> {
    this.rows.delete(id);
    return ok(undefined);
  }
  async retrieve(q: RetrievalQuery): Promise<Result<readonly RetrievedMemory[]>> {
    const terms = q.text.toLowerCase().split(/\W+/).filter(Boolean);
    const out: RetrievedMemory[] = [];
    for (const m of this.rows.values()) {
      if (q.kinds && !q.kinds.includes(m.kind)) continue;
      const hay = m.content.toLowerCase();
      const score = terms.filter((t) => hay.includes(t)).length;
      if (score > 0) out.push({ memory: m, similarity: score, score });
    }
    out.sort((a, b) => b.score - a.score);
    return ok(out);
  }
  async list(filter?: { kinds?: readonly MemoryKind[]; limit?: number }): Promise<
    Result<readonly Memory[]>
  > {
    let all = [...this.rows.values()];
    if (filter?.kinds) all = all.filter((m) => filter.kinds?.includes(m.kind));
    return ok(all);
  }
}

describe("indexKnowledge", () => {
  test("indexes markdown files as searchable knowledge memories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "socius-kb-"));
    const store = new FakeMemoryStore();
    await mkdir(join(dir, "projects"), { recursive: true });
    await writeFile(
      join(dir, "projects", "socius.md"),
      "---\ntitle: Socius\ntags: [architecture]\n---\n\nSocius uses SQLite and sqlite-vec for vector search.\n\nThe planner is a deterministic state graph.\n",
    );
    await writeFile(join(dir, "notes.md"), "# Notes\n\nRemember to water the plants on Sunday.\n");

    const res = unwrap(await indexKnowledge(dir, store));
    expect(res.files).toBe(2);
    expect(res.chunks).toBeGreaterThanOrEqual(2);

    const found = unwrap(
      await store.retrieve({ text: "vector search sqlite", kinds: ["knowledge"] }),
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.memory.content.toLowerCase()).toContain("sqlite");
    expect(found[0]?.memory.source.ref).toBe("projects/socius.md");

    await rm(dir, { recursive: true, force: true });
  });

  test("reindex is idempotent (clears prior knowledge memories)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "socius-kb-"));
    const store = new FakeMemoryStore();
    await writeFile(join(dir, "a.md"), "alpha beta gamma content here");
    unwrap(await indexKnowledge(dir, store));
    unwrap(await indexKnowledge(dir, store));
    const all = unwrap(await store.list({ kinds: ["knowledge"], limit: 1000 }));
    expect(all.length).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });
});
