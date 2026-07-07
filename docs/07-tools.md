# 07 — Tools

> Canonical decision: [ADR-0005](./adr/0005-unified-tools.md).

A tool is any capability the planner can invoke: reading a file, running `git diff`, searching
memory, sending an email. The central rule: **native tools and MCP tools implement the identical
interface. The planner cannot tell them apart.** There are no special cases.

Interface: `packages/core/src/tools.ts`.

## The interface

```ts
interface Tool {
  name; description;
  source: "native" | "mcp";
  inputSchema; outputSchema;        // JSON Schema — validation AND LLM description
  capabilities: Capability[];        // fs.read, net, exec, … (drives permissions)
  capabilityTags: string[];          // "git", "read", "summarize" — drives discovery
  destructive: boolean;              // defaults to requiring confirmation
  invoke(args, ctx): Promise<Result<ToolResult>>;
}
```

A tool declares everything the rest of the system needs to reason about it:
- **`inputSchema`** does double duty: it validates arguments *and* is what the planner shows the
  model when asking it to fill tool arguments. One schema, no drift.
- **`capabilities`** feed the permission layer ([`09-permissions.md`](./09-permissions.md)). A
  tool that writes files declares `fs.write`; policy decides whether that needs confirmation.
- **`capabilityTags`** feed discovery. The planner asks the registry "what tools can `git`?" and
  gets a set — it never hardcodes a tool name.
- **`destructive`** flags anything irreversible; such tools require confirmation unless policy
  explicitly allows them.

## Discovery, not wiring

```ts
interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  all(): readonly Tool[];
  findByTags(tags: readonly string[]): readonly Tool[];
}
```

Tools are **discovered dynamically**. At startup the daemon registers native tools and, for each
enabled MCP server, registers that server's tools wrapped as `Tool`s. The planner's `Plan` node
queries by capability tag and is handed a menu. Adding a tool — native or from a new MCP server —
requires **zero planner changes**. This is Principle #6 at the behavior layer.

## Validation boundary

`invoke` never trusts its input. Arguments are validated against `inputSchema` before the tool
runs; the result is validated against `outputSchema` before it returns. A tool that receives
bad args returns `TOOL_INPUT_INVALID` (a handled `Result`), not a thrown exception — the planner
can react (re-ask the model for corrected args) instead of crashing. This is the seam that keeps
a hallucinated tool call from becoming a stack trace.

## Execution context

```ts
interface ToolContext {
  callId; signal?;                   // cancellation
  onProgress?(message): void;         // stream progress from long-running tools
}
```

Long-running tools stream progress lines back through the daemon to the CLI, so a 30-second
`grep` across a repo shows life instead of hanging silently. `signal` lets the user Ctrl-C a tool
mid-run.

## Native tools (M3 onward)

The first native tools are the ones that make the morning workflow real: `fs.read`, `fs.list`,
`git.diff`, `git.log`, `git.status`, `memory.search`, `knowledge.search`. Each is a small module
implementing `Tool`, unit-tested against its schema. Destructive ones (`fs.write`, `fs.delete`)
declare themselves as such and default to confirmation.

## Why one interface for native + MCP (ADR-0005)

- **Why:** it makes MCP integration nearly free (a new server = new tools with no planner work)
  and keeps the planner simple (one abstraction). It embodies "everything is modular."
- **Alternatives:** separate native-tool and MCP-tool code paths; a plugin API distinct from
  the tool API.
- **Tradeoffs:** the common interface must be the *lowest common denominator* that both native
  code and MCP can satisfy — occasionally a native tool could expose something richer than MCP
  allows. We accept that; escape hatches (tool-specific metadata) exist without special-casing
  the planner.
- **Rejected separate paths** because they would double the planner's tool-handling logic and
  make every "does this apply to MCP too?" change a two-place edit — exactly the erosion of
  boundaries that kills a codebase at 100k LOC.
