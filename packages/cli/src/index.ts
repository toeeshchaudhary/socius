/**
 * @socius/cli — the thin client. Responsibilities: parse args + stdin, find or
 * lazy-spawn the daemon, stream tokens to stdout (raw when piped, pretty on a
 * TTY), and exit with a meaningful code. It holds no intelligence of its own.
 */
export interface ParsedInvocation {
  /** The prompt/question (positional args joined). */
  readonly input: string;
  /** Piped stdin, if the CLI was not attached to a TTY on stdin. */
  readonly stdin?: string;
  /** Subcommand, if the first token matches one (doctor, mem, trace, …). */
  readonly command?: string;
  readonly isTty: boolean;
}

/** Whether stdout is an interactive terminal — governs pretty vs raw output. */
export function stdoutIsTty(): boolean {
  return Boolean(process.stdout.isTTY);
}

export async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text.length > 0 ? text : undefined;
}
