/**
 * @socius/logging — structured logger + reasoning-trace sink.
 * A minimal console logger is provided now; a file/JSON sink lands in M1.
 */
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

/** No-op trace sink placeholder; the file-backed sink arrives with M1. */
export class NullTraceSink implements TraceSink {
  record(_trace: ReasoningTrace): void {}
}
