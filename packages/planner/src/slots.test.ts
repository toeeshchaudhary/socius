import { describe, expect, test } from "bun:test";
import { parseJson } from "./slots.ts";

describe("parseJson", () => {
  test("plain JSON", () => {
    expect(parseJson<Record<string, unknown>>('{"action":"answer"}')).toEqual({ action: "answer" });
  });

  test("JSON wrapped in prose and fences", () => {
    expect(parseJson<Record<string, unknown>>('Sure! Here you go:\n```json\n{"a":1}\n```')).toEqual(
      { a: 1 },
    );
  });

  test("trailing garbage after a balanced object", () => {
    expect(
      parseJson<Record<string, unknown>>('{"action":"answer"} and then some rambling'),
    ).toEqual({
      action: "answer",
    });
  });

  test("nested braces inside string values survive balanced extraction", () => {
    expect(parseJson<Record<string, unknown>>('x {"cmd":"echo {ok}","n":2} y')).toEqual({
      cmd: "echo {ok}",
      n: 2,
    });
  });

  test("spuriously escaped quotes from broken constrained decoders", () => {
    // Verbatim shape observed from an OpenRouter provider's json_schema mode.
    const soup =
      '{"action":"tool","tool\\":\\"composio/COMPOSIO_SEARCH_TOOLS\\",\\"reason\\":\\"Find Gmail tools.\\"}":"tool"}';
    expect(parseJson<Record<string, unknown>>(soup)).toEqual({
      action: "tool",
      tool: "composio/COMPOSIO_SEARCH_TOOLS",
      reason: "Find Gmail tools.",
    });
  });

  test("unparseable input returns null", () => {
    expect(parseJson<Record<string, unknown>>("no json here at all")).toBeNull();
    expect(parseJson<Record<string, unknown>>("{broken: [")).toBeNull();
  });
});
