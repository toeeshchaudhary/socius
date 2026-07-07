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
