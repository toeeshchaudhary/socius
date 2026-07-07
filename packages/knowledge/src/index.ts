/**
 * @socius/knowledge — the Markdown knowledge base (M2). Plain files with
 * frontmatter under ~/.local/share/socius/knowledge/{projects,journal,notes,
 * todos,architecture,meetings,ideas,experiments}. Files are canonical; the
 * SQLite index is derived and rebuildable. A file-watcher keeps it fresh.
 */
export { indexKnowledge, type IndexResult } from "./indexer.ts";

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
