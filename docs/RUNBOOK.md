# Runbook — running the M1 spine locally

The automated test suite is hermetic (`bun test`, no GPU/model needed). This runbook is for
driving the **real model** end-to-end on your machine.

## Prerequisites

- The GGUF model at `~/AI/models/gemma-4-E4B-it-Q4_K_M.gguf` (config default).
- `llama-server` built at `~/llama.cpp/build/bin/llama-server`.
- Bun ≥ 1.3.

## Status check

```sh
bun run packages/cli/src/main.ts doctor
```
Reports model/binary presence, socket path, and whether a daemon is already running.

## Fastest live check (single process)

`scripts/e2e.ts` starts the daemon in-process, loads the model on CPU, streams one answer,
and stops cleanly — no lingering background process:

```sh
bun run scripts/e2e.ts "In one sentence, confirm you are Socius running locally."
```
Expect `[e2e]` progress on stderr (model load time, token count) and the streamed answer on
stdout, then `PASS`.

## The real thing (lazy-spawned daemon)

```sh
bun run packages/cli/src/main.ts "explain this error" < build.log
echo "what does this do?" | bun run packages/cli/src/main.ts "review"
```
The first call spawns `sociusd` (warming the model — a few tens of seconds on CPU for this
model); subsequent calls are warm and fast. `socius restart` stops the daemon; it respawns on
next use.

> Note: this lazy-spawn path cannot run inside the CI sandbox (it reaps persistent child
> processes), which is why it is exercised here rather than in `bun test`.

## Performance tuning (`~/.config/socius/config.toml` once config loading lands, or edit
`packages/config/src/index.ts` defaults for now)

- **This model is CPU-only (`gpuLayers: 0`) by necessity.** Its ~5 GB Q4_K_M weights exceed the
  4 GB VRAM, so full GPU offload OOMs, and *partial* offload of this E-series architecture trips
  llama.cpp's `GGML_SCHED_MAX_SPLIT_INPUTS` assert and crashes. CPU-only is the reliable config.
- Want GPU speed? Use a model/quant that fits 4 GB (e.g. a ~3B Q4, or Gemma 3n **E2B**), then
  raise `gpuLayers` until `nvidia-smi` shows VRAM near full without OOM.
- `contextWindow` (default 4096) trades RAM/KV-cache for how much you can pipe in at once.

## Diagnostics

- `llama-server` output: `~/.local/state/socius/llama-server.log`.
- Daemon logs: stderr (structured JSON). Reasoning traces (M1 sink is a no-op; file sink is M2).
- Kill a stuck server/daemon: `pkill -f llama-server; pkill -f daemon/src/main`.
