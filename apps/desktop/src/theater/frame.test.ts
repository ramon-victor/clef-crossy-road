import { describe, expect, it } from "vitest";
import { pickMode } from "./frame.ts";

const ASKING = { input: { model: "clef-flash", state: {}, questions: {} }, since: 0 } as const;
const LAST = { index: 3 } as never;

describe("pickMode", () => {
  it("shows nothing before any question, the question while it is out, the answer after", () => {
    expect(pickMode({ asking: null, lastModel: null })).toBe("waiting");
    expect(pickMode({ asking: ASKING, lastModel: null })).toBe("reading");
    expect(pickMode({ asking: null, lastModel: LAST })).toBe("answered");
  });

  it("shows the new question as soon as it goes out, even with an answer still on screen", () => {
    expect(pickMode({ asking: ASKING, lastModel: LAST })).toBe("reading");
  });
});
