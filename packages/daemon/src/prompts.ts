/**
 * Prompt templates are config, not code (Principle #5). Defaults are written to
 * `promptsDir` on first run so the user can read and edit exactly what the model
 * is told.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_SYSTEM = `You are Socius, a local-first AI companion that lives in the user's terminal.

You are concise, direct, and technical. You are talking to an engineer, not a customer.
When given piped input (a diff, a log, code, command output), analyze it directly and
answer the question asked. Prefer specifics over generalities. Use Markdown sparingly —
your output is read in a terminal. Do not pad answers with filler or restate the question.
`;

export async function loadSystemPrompt(promptsDir: string): Promise<string> {
  const path = join(promptsDir, "system.md");
  const file = Bun.file(path);
  if (await file.exists()) {
    const text = (await file.text()).trim();
    if (text.length > 0) return text;
  }
  // Seed the default so it becomes inspectable/editable on disk.
  try {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, DEFAULT_SYSTEM);
  } catch {
    // non-fatal: fall back to the in-memory default
  }
  return DEFAULT_SYSTEM.trim();
}
