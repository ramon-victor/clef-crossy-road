import { describe, expect, it } from "vitest";
import { errorMessages, parseResult } from "./schema.ts";

const payload = {
  answers: {
    move: { type: "choice", choice: "stay", probabilities: { stay: 1 }, confidence: 0.5 },
  },
  usage: { input_tokens: 10, output_tokens: 2 },
};

describe("parseResult", () => {
  it("accepts the REST envelope and the Worker-binding shape alike", () => {
    const expected = {
      answers: {
        move: { type: "choice", choice: "stay", probabilities: { stay: 1 }, confidence: 0.5 },
      },
      usage: { inputTokens: 10, outputTokens: 2 },
    };
    expect(parseResult({ result: payload, success: true })).toEqual(expected);
    expect(parseResult(payload)).toEqual(expected);
  });

  it("parses noul answers as objects with a numeric noul field", () => {
    const parsed = parseResult({
      result: { answers: { q: { type: "noul", noul: 0.4564 } }, usage: { input_tokens: 363 } },
    });
    expect(parsed.answers.q).toEqual({ type: "noul", noul: 0.4564 });
  });

  it("counts missing output tokens as zero", () => {
    const parsed = parseResult({ answers: {}, usage: { input_tokens: 5 } });
    expect(parsed.usage).toEqual({ inputTokens: 5, outputTokens: 0 });
  });

  it.each([
    ["no answers", { usage: { input_tokens: 1 } }],
    ["no usage", { answers: {} }],
    [
      "a choice without its fields",
      { answers: { move: { type: "choice" } }, usage: { input_tokens: 1 } },
    ],
    ["an unknown answer type", { answers: { q: { type: "vote" } }, usage: { input_tokens: 1 } }],
    ["null", null],
    ["text", "ok"],
  ])("rejects %s with a schema error", (_name, json) => {
    expect(() => parseResult(json)).toThrow(expect.objectContaining({ kind: "schema" }));
  });
});

describe("errorMessages", () => {
  it("joins the messages of errors[]", () => {
    expect(errorMessages({ errors: [{ message: "a" }, { code: 1, message: "b" }] })).toBe("a; b");
  });

  it("returns nothing when there is no usable errors array", () => {
    for (const json of [null, "x", {}, { errors: "x" }, { errors: [{ code: 1 }, null] }]) {
      expect(errorMessages(json)).toBe("");
    }
  });

  it("is capped, so a huge error body cannot flood a log", () => {
    expect(errorMessages({ errors: [{ message: "x".repeat(1000) }] })).toHaveLength(400);
  });
});
