import { describe, expect, test } from "bun:test";
import type { PermissionRequest } from "@socius/core";
import { ConfiguredPolicyEngine } from "./index.ts";

const req = (over: Partial<PermissionRequest>): PermissionRequest => ({
  toolName: "t",
  capabilities: [],
  reasoning: "",
  mode: "live",
  ...over,
});

describe("ConfiguredPolicyEngine", () => {
  const engine = new ConfiguredPolicyEngine({
    "fs.read": "allow",
    "fs.write": "confirm",
    secrets: "deny",
  });

  test("allows when every capability is allowed", () => {
    expect(engine.evaluate(req({ capabilities: ["fs.read"] })).decision).toBe("allow");
  });

  test("requires confirmation when any capability needs it", () => {
    expect(engine.evaluate(req({ capabilities: ["fs.read", "fs.write"] })).decision).toBe("confirm");
  });

  test("deny wins over everything", () => {
    expect(
      engine.evaluate(req({ capabilities: ["fs.read", "fs.write", "secrets"] })).decision,
    ).toBe("deny");
  });

  test("unknown capability defaults to confirm (safe)", () => {
    expect(engine.evaluate(req({ capabilities: ["net"] })).decision).toBe("confirm");
  });

  test("dry-run never has side effects, so it is always allowed", () => {
    expect(engine.evaluate(req({ capabilities: ["fs.write"], mode: "dry_run" })).decision).toBe(
      "allow",
    );
  });
});

describe("ConfiguredPolicyEngine overrides", () => {
  test("per-tool override loosens a confirm capability to allow", () => {
    const engine = new ConfiguredPolicyEngine({ "fs.write": "confirm" }, { tools: { "git.commit": "allow" } });
    expect(engine.evaluate(req({ toolName: "git.commit", capabilities: ["fs.write"] })).decision).toBe("allow");
    // a different tool is unaffected
    expect(engine.evaluate(req({ toolName: "fs.write", capabilities: ["fs.write"] })).decision).toBe("confirm");
  });

  test("per-tool override can deny", () => {
    const engine = new ConfiguredPolicyEngine({ "fs.read": "allow" }, { tools: { "fs.read": "deny" } });
    expect(engine.evaluate(req({ toolName: "fs.read", capabilities: ["fs.read"] })).decision).toBe("deny");
  });

  test("path deny always wins", () => {
    const engine = new ConfiguredPolicyEngine(
      { "fs.write": "allow" },
      { paths: [{ prefix: "/etc", decision: "deny" }] },
    );
    expect(
      engine.evaluate(req({ capabilities: ["fs.write"], resources: ["/etc/passwd"], mode: "live" })).decision,
    ).toBe("deny");
  });

  test("a trusted path prefix downgrades confirm to allow", () => {
    const engine = new ConfiguredPolicyEngine(
      { "fs.write": "confirm" },
      { paths: [{ prefix: "/home/me/scratch", decision: "allow" }] },
    );
    expect(
      engine.evaluate(req({ capabilities: ["fs.write"], resources: ["/home/me/scratch/note.txt"], mode: "live" }))
        .decision,
    ).toBe("allow");
    // outside the trusted prefix, still confirm
    expect(
      engine.evaluate(req({ capabilities: ["fs.write"], resources: ["/home/me/other.txt"], mode: "live" })).decision,
    ).toBe("confirm");
  });
});
