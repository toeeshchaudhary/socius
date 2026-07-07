/**
 * The CLI ⇄ daemon wire contract. Transport is newline-delimited JSON-RPC 2.0
 * over a Unix domain socket. The protocol version is exchanged in the handshake
 * so a stale CLI and a newer daemon fail loudly rather than behaving strangely.
 */
import type { RequestId } from "./ids.ts";

export const IPC_PROTOCOL_VERSION = 0 as const;

/** Client → daemon: negotiate protocol + learn model/daemon state. */
export interface HandshakeRequest {
  readonly protocolVersion: number;
  readonly clientVersion: string;
}

export interface HandshakeResponse {
  readonly protocolVersion: number;
  readonly daemonVersion: string;
  readonly modelReady: boolean;
  readonly modelId: string;
}

/** Client → daemon: run one reasoning request (the pipe-to-reason path). */
export interface InferParams {
  readonly input: string;
  readonly stdin?: string;
  readonly mode?: "dry_run" | "sandbox" | "live";
}

/** Daemon → client streaming notifications during an Infer call. */
export type InferNotification =
  | { readonly kind: "token"; readonly text: string }
  | { readonly kind: "step"; readonly label: string }
  | { readonly kind: "confirm"; readonly id: string; readonly prompt: string }
  | { readonly kind: "done"; readonly usage?: { promptTokens: number; completionTokens: number } };

/** JSON-RPC 2.0 framing. */
export interface RpcRequest<M extends string = string, P = unknown> {
  readonly jsonrpc: "2.0";
  readonly id: RequestId;
  readonly method: M;
  readonly params: P;
}

export interface RpcNotification<M extends string = string, P = unknown> {
  readonly jsonrpc: "2.0";
  readonly method: M;
  readonly params: P;
}

export interface RpcResponse<R = unknown> {
  readonly jsonrpc: "2.0";
  readonly id: RequestId;
  readonly result?: R;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export type IpcMethod = "handshake" | "infer" | "cancel" | "shutdown" | "health";
