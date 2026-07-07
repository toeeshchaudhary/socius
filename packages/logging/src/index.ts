/**
 * @socius/logging — structured logger + reasoning-trace sink.
 * A minimal console logger is provided now; a file/JSON sink lands in M1.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger, LogLevel, ReasoningTrace, TraceSink } from "@socius/core";
import type { Subsystem } from "@socius/core";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface ConsoleLoggerOptions {
  readonly level: LogLevel;
  readonly subsystem?: Subsystem;
}

export class ConsoleLogger implements Logger {
  private readonly threshold: number;
  private readonly subsystem?: Subsystem;

  constructor(opts: ConsoleLoggerOptions) {
    this.threshold = LEVELS[opts.level];
    if (opts.subsystem !== undefined) this.subsystem = opts.subsystem;
  }

  child(subsystem: Subsystem): Logger {
    const level = (Object.keys(LEVELS) as LogLevel[]).find((l) => LEVELS[l] === this.threshold);
    return new ConsoleLogger({ level: level ?? "info", subsystem });
  }

  private emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVELS[level] < this.threshold) return;
    const record = {
      t: new Date().toISOString(),
      level,
      sub: this.subsystem,
      msg: message,
      ...fields,
    };
    // stderr so it never contaminates piped stdout (Principle: feels like grep).
    process.stderr.write(`${JSON.stringify(record)}\n`);
  }

  debug(m: string, f?: Record<string, unknown>): void {
    this.emit("debug", m, f);
  }
  info(m: string, f?: Record<string, unknown>): void {
    this.emit("info", m, f);
  }
  warn(m: string, f?: Record<string, unknown>): void {
    this.emit("warn", m, f);
  }
  error(m: string, f?: Record<string, unknown>): void {
    this.emit("error", m, f);
  }
}

/** No-op trace sink (used when tracing is disabled). */
export class NullTraceSink implements TraceSink {
  record(_trace: ReasoningTrace): void {}
}

/**
 * Appends reasoning traces as JSON Lines to a file, so `socius trace` can replay
 * exactly what the model saw and decided at each slot (Principle #5). Obvious
 * secrets are redacted before writing.
 */
export class FileTraceSink implements TraceSink {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }
  record(trace: ReasoningTrace): void {
    const safe = {
      ...trace,
      prompt: redact(trace.prompt),
      rawOutput: redact(trace.rawOutput),
    };
    try {
      appendFileSync(this.path, `${JSON.stringify(safe)}\n`);
    } catch {
      // tracing must never break a request
    }
  }
}

/** Redact obvious credentials (API keys, bearer tokens) from trace text. */
function redact(s: string): string {
  return s
    .replace(/\bck_[A-Za-z0-9_-]{6,}/g, "ck_***")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***")
    .replace(/\b(sk|pk|gh[pousr])_[A-Za-z0-9_-]{6,}/g, "$1_***");
}
