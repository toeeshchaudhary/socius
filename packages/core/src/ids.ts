/**
 * Branded ID types. Structurally these are strings, but the brand prevents
 * accidentally passing a MemoryId where a SessionId is expected.
 */

declare const brand: unique symbol;
export type Brand<T, B> = T & { readonly [brand]: B };

export type MemoryId = Brand<string, "MemoryId">;
export type SessionId = Brand<string, "SessionId">;
export type RequestId = Brand<string, "RequestId">;
export type ToolCallId = Brand<string, "ToolCallId">;
export type TraceId = Brand<string, "TraceId">;

/** Milliseconds since the Unix epoch. */
export type Timestamp = Brand<number, "Timestamp">;

export const asMemoryId = (s: string): MemoryId => s as MemoryId;
export const asSessionId = (s: string): SessionId => s as SessionId;
export const asRequestId = (s: string): RequestId => s as RequestId;
export const asTraceId = (s: string): TraceId => s as TraceId;
