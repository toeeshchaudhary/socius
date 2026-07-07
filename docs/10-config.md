# 10 — Configuration

Everything is configurable, and configuration is **hand-editable, commented TOML** that you own.
No settings are hidden in a database or a binary. Reference: `packages/config/`.

## Format and location

- **Format: TOML.** Human-first: comments, sections, no brace soup. Config is edited by people,
  not machines.
- **Location:** `~/.config/socius/config.toml` (XDG). Prompt templates live as files in
  `~/.config/socius/prompts/`. Path resolution is in `packages/config/src/paths.ts`.

```
~/.config/socius/
  config.toml
  prompts/
    system.md
    classify.md
    plan.md
```

## Layering and precedence

Config is resolved in layers, later overriding earlier:

```
built-in defaults  ‹  config.toml  ‹  environment (SOCIUS_*)  ‹  CLI flags
```

- **Defaults** are code (`defaultConfig()` in `packages/config/src/index.ts`), tuned for the
  4 GB-VRAM reference machine, so Socius runs with no config file at all.
- **`config.toml`** is the durable per-user layer.
- **Environment** (`SOCIUS_MODEL_PATH`, `SOCIUS_LOG_LEVEL`, …) suits containers and one-offs.
- **CLI flags** win, for a single invocation (`socius --mode dry_run "…"`).

## Validation

The resolved config is validated with **zod** before anything uses it. An invalid config fails
fast with a precise message (`CONFIG_INVALID`, pointing at the offending key) rather than
surfacing as a mysterious runtime error later. `socius doctor` runs this validation and reports
the result.

## The shape

The full schema is `SociusConfig` in `packages/core/src/config.ts`. Sections:

| Section | Governs |
|---------|---------|
| `model` | model id, GGUF path, context window, GPU layers |
| `inference` | llama-server binary, host/port, startup timeout, embedder |
| `daemon` | socket path, pidfile, idle timeout |
| `memory` | retrieval `k`, token budget, confidence half-life |
| `permissions` | default mode + per-capability policy |
| `logging` | level, directory, whether to record reasoning traces |
| `mcp` | array of MCP servers |
| `promptsDir` | where prompt templates live |

## Prompt templates are config, not code

System prompts and slot prompts are **files** in `promptsDir`, not string literals in the
source (Principle #5). You can read, diff, and edit exactly what the model is told, and Socius
ships sensible defaults that are copied on first run. This keeps the model's instructions
inspectable and lets a user tune behavior without touching TypeScript.

## Hot reload (M2+)

The daemon watches `config.toml`. Safe-to-reload sections (logging level, memory budgets,
permission policy, prompts) apply live. Sections that require a restart (model path, ports) are
detected and reported: Socius tells you a restart is needed rather than silently ignoring the
change.

## Why TOML over JSON/YAML (ADR-0008)

- **Why:** TOML is unambiguous, supports comments (essential for a file humans maintain), and has
  no YAML footguns (the Norway problem, significant whitespace). JSON has no comments.
- **Rejected JSON** because a config a human edits daily needs comments and trailing-comma
  tolerance; **rejected YAML** for its ambiguous type coercion and whitespace sensitivity, which
  cause silent, surprising misconfigurations — unacceptable for the file that governs
  permissions.
