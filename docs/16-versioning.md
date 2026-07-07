# 16 — Versioning

Socius has **four** independently versioned surfaces. Conflating them is a classic mistake that
bites once a tool is installed on real machines with drifting components.

| Surface | Versioned by | Breaks when… |
|---------|--------------|--------------|
| **Application** (SemVer) | `package.json` version | user-facing behavior / CLI changes |
| **IPC protocol** | `IPC_PROTOCOL_VERSION` (`core/src/ipc.ts`) | CLI↔daemon wire format changes |
| **Data schema** | migration `version` (`storage`) | the SQLite schema changes |
| **Plugin/Tool API** | `Tool` interface version | the contract native/MCP tools implement changes |

## Application: SemVer

Standard [SemVer](https://semver.org). Pre-1.0 (where we are now), minor versions may break —
this is signalled clearly. Post-1.0, MAJOR for breaking user-facing changes, MINOR for features,
PATCH for fixes.

## IPC protocol

The CLI and daemon are separate binaries that **can drift** — a user updates the package but a
long-lived daemon is still running the old code, or vice versa. The handshake exchanges
`protocolVersion`; a mismatch fails loudly with `IPC_PROTOCOL_MISMATCH` and the CLI advises
`socius restart`, rather than sending a request the other side will misread. The protocol version
bumps only on wire-format changes, independently of the app version.

## Data schema

Forward-only, numbered migrations ([`11-storage.md`](./11-storage.md)). The daemon refuses to run
against a schema newer than it understands (a downgrade after data was migrated), and applies any
pending migrations on startup inside a transaction. The current schema version is recorded in
`schema_migrations`; `socius doctor` surfaces it.

## Plugin/Tool API

Once third parties ship tools (native plugins or MCP servers relying on our capability
semantics), the `Tool` interface is a public contract. Breaking it is a MAJOR event, documented in
a migration note. Additive changes (new optional fields) are backward-compatible. The capability
vocabulary ([`09-permissions.md`](./09-permissions.md)) is versioned alongside it — removing or
repurposing a capability is breaking.

## Compatibility policy

- Within a MAJOR line, older config files load (new keys have defaults) and older data schemas
  migrate forward automatically.
- A protocol or schema bump ships with the migration/handshake logic to detect and handle the old
  version gracefully — never a silent misinterpretation.
- Deprecations get one MINOR of warnings before removal.

## Why four versions instead of one

- **Why:** these surfaces change at different rates and are exposed to different consumers (the
  user, the running daemon, the on-disk DB, third-party tools). A single version number would
  force a MAJOR bump for any change to any surface, or — worse — hide a wire/schema break inside a
  PATCH. Independent versions let each surface signal its own compatibility honestly.
- **Tradeoff:** four numbers to track. Contained by deriving three of them from code constants and
  checking them automatically at the handshake and at migration time, so drift is caught by the
  machine, not by the user hitting a corrupt state.
