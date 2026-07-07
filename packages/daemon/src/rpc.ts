/**
 * Newline-delimited JSON-RPC 2.0 framing over the Unix socket. One JSON object
 * per line. Requests carry an `id`; the daemon answers with a matching response
 * and, for streaming methods, emits `notify` messages before the final response.
 */
import type { InferNotification, RequestId, RpcResponse } from "@socius/core";

export interface WireRequest {
  readonly jsonrpc: "2.0";
  readonly id: RequestId;
  readonly method: string;
  readonly params?: unknown;
}

export function encode(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

export function response<R>(id: RequestId, result: R): string {
  return encode({ jsonrpc: "2.0", id, result } satisfies RpcResponse<R>);
}

export function errorResponse(id: RequestId, code: number, message: string): string {
  return encode({ jsonrpc: "2.0", id, error: { code, message } } satisfies RpcResponse);
}

export function notify(n: InferNotification): string {
  return encode({ jsonrpc: "2.0", method: "notify", params: n });
}

/**
 * Accumulates bytes and yields whole JSON lines. Handles messages split across
 * TCP/Unix reads and multiple messages in one read.
 */
export class LineBuffer {
  private buf = "";
  push(chunk: string): WireRequest[] {
    this.buf += chunk;
    const out: WireRequest[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line.length === 0) continue;
      try {
        out.push(JSON.parse(line) as WireRequest);
      } catch {
        // ignore malformed lines rather than tearing down the connection
      }
    }
    return out;
  }
}
