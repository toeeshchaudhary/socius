import { beforeEach, describe, expect, test } from "bun:test";
import { unwrap } from "@socius/core";
import { HashingEmbedder } from "@socius/inference";
import { SociusDatabase } from "@socius/storage";
import { SqliteMemoryStore } from "./store.ts";

async function freshStore(): Promise<SqliteMemoryStore> {
  const embedder = new HashingEmbedder(256);
  const db = unwrap(await SociusDatabase.open(":memory:", embedder.dimensions));
  return new SqliteMemoryStore(db, embedder, { confidenceHalfLifeDays: 30 });
}

describe("SqliteMemoryStore", () => {
  let store: SqliteMemoryStore;

  beforeEach(async () => {
    store = await freshStore();
    unwrap(
      await store.remember({
        kind: "project",
        content: "The renderer crashes on startup due to a null pointer dereference",
        source: { origin: "chat" },
      }),
    );
    unwrap(
      await store.remember({
        kind: "preference",
        content: "I prefer TypeScript over Python for writing tools",
        source: { origin: "user" },
      }),
    );
    unwrap(
      await store.remember({
        kind: "journal",
        content: "Discussed the database migration plan and rollout schedule",
        source: { origin: "user" },
      }),
    );
  });

  test("stores and lists memories", async () => {
    const all = unwrap(await store.list());
    expect(all).toHaveLength(3);
    expect(new Set(all.map((m) => m.kind))).toEqual(new Set(["project", "preference", "journal"]));
  });

  test("retrieval ranks the most relevant memory first", async () => {
    const results = unwrap(await store.retrieve({ text: "renderer null pointer crash on startup" }));
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.memory.content).toContain("renderer crashes");
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  test("keyword hit surfaces a memory even with sparse vector overlap", async () => {
    const results = unwrap(await store.retrieve({ text: "TypeScript" }));
    expect(results.some((r) => r.memory.content.includes("TypeScript"))).toBe(true);
  });

  test("kind filter restricts results", async () => {
    const results = unwrap(await store.retrieve({ text: "database migration", kinds: ["journal"] }));
    expect(results.every((r) => r.memory.kind === "journal")).toBe(true);
  });

  test("token budget caps how much is returned", async () => {
    const tiny = unwrap(await store.retrieve({ text: "renderer typescript database", tokenBudget: 1 }));
    expect(tiny.length).toBe(1); // at least one, but budget stops further inclusion
  });

  test("forget removes a memory from all indexes", async () => {
    const all = unwrap(await store.list());
    const target = all.find((m) => m.kind === "preference")!;
    unwrap(await store.forget(target.id));
    expect(unwrap(await store.list())).toHaveLength(2);
    const back = unwrap(await store.retrieve({ text: "TypeScript Python tools" }));
    expect(back.some((r) => r.memory.id === target.id)).toBe(false);
  });

  test("update re-embeds and reflects new content", async () => {
    const all = unwrap(await store.list());
    const target = all.find((m) => m.kind === "journal")!;
    unwrap(await store.update(target.id, { content: "Kubernetes cluster autoscaling notes" }));
    const got = unwrap(await store.get(target.id));
    expect(got?.content).toContain("Kubernetes");
    const results = unwrap(await store.retrieve({ text: "kubernetes autoscaling" }));
    expect(results.some((r) => r.memory.content.includes("Kubernetes"))).toBe(true);
  });
});
