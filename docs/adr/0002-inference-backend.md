# ADR-0002 — Model behind an `InferenceBackend` interface; CPU embeddings

Status: Accepted
Date: 2026-07-07

## Context
The brief demands that swapping the model require zero architectural change (Principle #6). The
reference GPU has only 4 GB VRAM, which cannot hold both a chat model and an embedding model.

## Decision
Define `InferenceBackend` (chat/reasoning, streaming) and a separate `Embedder` (vectors) in
`@socius/core`. The first backend is a llama.cpp HTTP adapter; the daemon supervises
`llama-server` as a child process. Embeddings run on a **second, CPU-pinned** `llama-server`
`--embeddings` instance so they never contend for VRAM. Nothing above `inference` references
"Gemma."

## Alternatives considered
1. In-process model bindings (node-llama-cpp / FFI) instead of an HTTP child.
2. Embeddings on the GPU alongside the chat model.
3. A dedicated embedding runtime (fastembed / onnxruntime-node) instead of llama.cpp.

## Tradeoffs
Out-of-process inference adds an HTTP hop and child-supervision code, but isolates CUDA crashes
(a child exit, not a daemon crash) and keeps the C++/CUDA toolchain out of the Node process.
Same-tech embeddings mean one runtime to install and supervise, at some memory cost vs. a
lighter ONNX runtime.

## Long-term implications
A bigger local model or a remote OpenAI-compatible endpoint is a new adapter selected by config —
this is also what makes an autonomous planner mode viable later without a rewrite.

## Why the alternatives were rejected
1. In-process bindings couple the daemon's stability to native model code and complicate the
   build; a model segfault would take down the daemon.
2. GPU embeddings can't co-reside with the chat model in 4 GB.
3. A separate embedding runtime adds a native dependency and a second inference stack now; the
   `Embedder` interface lets us switch to it later if profiling justifies it.
