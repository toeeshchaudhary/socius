/**
 * @socius/knowledge — the Markdown knowledge base (M2). Plain files with
 * frontmatter under ~/.local/share/socius/knowledge/{projects,journal,notes,
 * todos,architecture,meetings,ideas,experiments}. Files are canonical; the
 * SQLite index is derived and rebuildable. A file-watcher keeps it fresh.
 */
import { type Result, error } from "@socius/core";

export const KNOWLEDGE_FOLDERS = [
  "projects",
  "journal",
  "notes",
  "todos",
  "architecture",
  "meetings",
  "ideas",
  "experiments",
] as const;

export type KnowledgeFolder = (typeof KNOWLEDGE_FOLDERS)[number];

export interface KnowledgeDoc {
  readonly path: string;
  readonly folder: KnowledgeFolder;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;
}

export async function indexKnowledge(_dir: string): Promise<Result<number>> {
  return { ok: false, error: error("NOT_IMPLEMENTED", "knowledge", "indexKnowledge (M2).") };
}
