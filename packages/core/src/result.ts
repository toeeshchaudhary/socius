/**
 * A `Result` is an explicit success-or-failure value. Socius prefers returning
 * `Result` over throwing for *expected* failures (a tool denied by policy, a
 * backend being unhealthy, an invalid config). Throwing is reserved for
 * programmer errors and truly exceptional conditions.
 *
 * This keeps failure paths visible in the type system, which matters for
 * Principle #2 (graceful degradation): callers are forced to handle the
 * degraded case instead of letting an exception bubble past a module boundary.
 */
import type { SociusError } from "./errors.ts";

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = SociusError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

/** Unwrap or throw. Use only where a failure genuinely is a bug. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw r.error instanceof Error ? r.error : new Error(String(r.error));
}
