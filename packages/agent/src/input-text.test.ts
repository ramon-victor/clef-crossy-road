import { describe, expect, it } from "vitest";
import { inputAsJson, inputAsText, optionsOf, prettyState, sentences } from "./input-text.ts";
import type { ModelInput } from "./policy.ts";

const input: ModelInput = {
  model: "clef-flash",
  state: {
    player: { col: 0 },
    rows: [
      { dz: 0, kind: "grass" },
      { dz: 1, kind: "water", platforms: [] },
    ],
  },
  questions: {
    move: {
      type: "choice",
      instructions:
        "You control a chicken. Rows with larger dz are further ahead. Speeds are 0.2 s long.",
      criteria: { stay: "Wait.", hop_back: "Go back.", hop_forward: "Go on." },
    },
  },
};

describe("prettyState", () => {
  it("shows a text map as it is", () => {
    expect(prettyState("MAP\nrow")).toBe("MAP\nrow");
  });

  it("puts each row of a JSON world on its own line and stays valid JSON", () => {
    const text = prettyState(input.state);
    expect(text.split("\n")).toHaveLength(7);
    expect(text).toContain('    {"dz":1,"kind":"water","platforms":[]}');
    expect(JSON.parse(text)).toEqual(input.state);
  });

  it("falls back to plain pretty JSON for anything else", () => {
    expect(prettyState([1, 2])).toBe("[\n  1,\n  2\n]");
    expect(prettyState(null)).toBe("null");
  });
});

describe("sentences", () => {
  it("breaks after a full stop that starts a new sentence and leaves decimals alone", () => {
    expect(sentences(input.questions.move?.instructions ?? "")).toBe(
      "You control a chicken.\nRows with larger dz are further ahead.\nSpeeds are 0.2 s long.",
    );
  });
});

describe("what the model was sent, written out", () => {
  const question = input.questions.move as ModelInput["questions"][string];

  it("lists the options in the order the service sorts them", () => {
    expect(optionsOf(question).map(([id]) => id)).toEqual(["hop_back", "hop_forward", "stay"]);
    expect(optionsOf({ type: "noul", instructions: "x" })).toEqual([]);
  });

  it("prints question, options and state as plain text", () => {
    const text = inputAsText({ ...input, images: 1 });
    expect(text).toContain('== QUESTION "move" (choice) ==');
    expect(text).toContain("hop_back: Go back.");
    expect(text).toContain("== STATE ==");
    expect(text).toContain("(1 picture sent with the state)");
  });

  it("round-trips as JSON", () => {
    expect(JSON.parse(inputAsJson(input))).toEqual(input);
  });
});
