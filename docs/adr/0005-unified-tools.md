# ADR-0005 — One `Tool` interface for native and MCP tools

Status: Accepted
Date: 2026-07-07

## Context
Socius needs native tools (filesystem, git, memory) and MCP tools (Gmail, etc.), and integrating
a new MCP server should be near-free. The planner should not carry special cases per tool source.

## Decision
Define a single `Tool` interface in `@socius/core` (name, description, input/output JSON Schema,
capabilities, capability tags, destructive flag, `invoke`). Native tools implement it directly;
MCP tools are wrapped by an `McpToolAdapter` that implements the same interface. A registry
supports capability-tag discovery. The planner selects tools by tag and cannot tell native from
MCP apart.

## Alternatives considered
1. Separate code paths for native tools and MCP tools.
2. A distinct plugin API separate from the tool API.

## Tradeoffs
The shared interface is a lowest-common-denominator both sources must satisfy; a native tool
occasionally could expose something richer than MCP allows. Accepted — escape-hatch metadata
exists without special-casing the planner. Gained: MCP integration is config-only and the
planner's tool logic exists once.

## Long-term implications
Adding tools — native or from a new MCP server — needs zero planner changes. Exposing Socius as an
MCP server later reuses the same registry behind a new transport.

## Why the alternatives were rejected
1. Separate paths double the planner's tool logic and make every change a two-place edit —
   boundary erosion that compounds at 100k LOC.
2. A separate plugin API fragments the ecosystem and contradicts "everything identical, no special
   cases."
