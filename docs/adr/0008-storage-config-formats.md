# ADR-0008 — SQLite for state, TOML for config, Markdown for knowledge

Status: Accepted
Date: 2026-07-07

## Context
Socius is single-user, local-first, no telemetry, no account. It has three kinds of persistent
data with different audiences: structured state (machine), configuration (edited by a human), and
knowledge (a durable human artifact).

## Decision
Use the right format for each:
- **SQLite** (`bun:sqlite` + `sqlite-vec` + FTS5) for structured state and derived indexes — one
  file the user owns.
- **TOML** for configuration — commented, unambiguous, human-first.
- **Markdown** (+ frontmatter) for the knowledge base — canonical, portable, greppable; SQLite
  holds only a derived, rebuildable index of it.

## Alternatives considered
- State: Postgres or another server DB; flat files.
- Config: JSON or YAML.
- Knowledge: rows in SQLite instead of files.

## Tradeoffs
Three formats instead of one to learn. Justified: each matches its audience, and the split keeps
the human artifacts (config, notes) legible without Socius while the machine state stays
transactional and queryable. Files ↔ index sync is one-directional (files are truth), avoiding
conflict resolution.

## Long-term implications
Backup is copying one DB file plus a folder. Everything survives Socius's deletion. No server, no
account, no network surface — Principle #1 by construction.

## Why the alternatives were rejected
- Postgres/servers: an always-on process and network surface for a single local user — rejected
  by the brief and by local-first simplicity.
- JSON config: no comments, brittle for a human-maintained file governing permissions. YAML:
  ambiguous type coercion and whitespace footguns cause silent misconfiguration.
- Knowledge in SQLite: opaque to `grep`/editors and couples note survival to Socius's schema; the
  canonical copy must be plain files.
