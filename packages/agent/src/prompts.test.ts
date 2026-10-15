import { hashString } from "@ccr/clef";
import { ACTIONS } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { ENCODER_IDS } from "./encode.ts";
import {
  ACTION_CRITERIA,
  choiceInstructions,
  criteriaFor,
  MANUAL_IDS,
  MANUALS,
  ROUTING_CRITERIA,
  riskInstructions,
} from "./prompts.ts";

/**
 * Hashes of the prompt text the cached benchmark answers were made with. If one of these changes, every
 * cached answer for that condition is stale and the free replays in the app stop being free.
 */
const GOLDEN: Record<string, string> = {
  "full/json": "18cb4ec1e3a66b",
  "full/grid": "18cb4ec1e3a66b",
  "full/image": "0394121c3214e9",
  "full/json-rel": "12830acb1044f7",
  "full/view": "13062c57424596",
  "full/view-fx": "14f97669500c93",
  "full/json-fx": "005a72b7572450",
  "minimal/json": "0082d0108108b2",
  "minimal/grid": "0082d0108108b2",
  "minimal/image": "191eb9ac5cf513",
  "minimal/json-rel": "00dee32c3d52a0",
  "minimal/view": "10f88749945821",
  "minimal/view-fx": "0836d7f3b32115",
  "minimal/json-fx": "0ef78a0cef4084",
};

describe("the first prompt styles are frozen", () => {
  it("full and minimal still say exactly what they said when their answers were cached", () => {
    for (const [key, hash] of Object.entries(GOLDEN)) {
      const [manual, encoder] = key.split("/");
      const text = choiceInstructions(
        manual as "full" | "minimal",
        encoder as (typeof ENCODER_IDS)[number],
      );
      expect(hashString(text), key).toBe(hash);
    }
    expect(hashString(JSON.stringify(ACTION_CRITERIA))).toBe("00516f36e76a86");
    expect(hashString(riskInstructions("full", "hop_forward", "json-fx"))).toBe("1c2780dd6bd512");
    expect(criteriaFor("full")).toBe(ACTION_CRITERIA);
    expect(criteriaFor("minimal")).toBe(ACTION_CRITERIA);
  });
});

describe("routing: a short question and options that say when each move applies", () => {
  it("is one of the styles, with an option for every move", () => {
    expect(MANUAL_IDS).toContain("routing");
    expect(Object.keys(ROUTING_CRITERIA).sort()).toEqual([...ACTIONS].sort());
    expect(criteriaFor("routing")).toBe(ROUTING_CRITERIA);
  });

  it("is much shorter than the full rules and asks a question instead of 'the best action'", () => {
    expect(MANUALS.routing.length).toBeLessThan(MANUALS.full.length * 0.8);
    const text = choiceInstructions("routing", "json");
    expect(text.endsWith("Which move does the chicken make now?")).toBe(true);
    expect(text).not.toMatch(/as far forward as possible|single best action/i);
  });

  it("options say when a move applies, in general terms: no numbers, nothing taken from a state", () => {
    for (const [action, text] of Object.entries(ROUTING_CRITERIA)) {
      expect(text, action).not.toMatch(/\d/);
      expect(text, action).toMatch(/\b(when|cannot|can be|about to|stuck)\b/i);
    }
  });

  it("never advises and never says which move is safe in a given situation", () => {
    for (const encoder of ENCODER_IDS) {
      const text = choiceInstructions("routing", encoder);
      expect(text, encoder).not.toMatch(/\b(should|safest|best move|you must|avoid)\b/i);
    }
  });

  it("uses the words of the view it describes: dcol for the relative views, col for the plain one", () => {
    const relative = choiceInstructions("routing", "json-fx");
    expect(relative).toContain("dcol");
    expect(relative).toContain("blocked_dcols");
    expect(relative).not.toContain("blocked_cols");

    const plain = choiceInstructions("routing", "json");
    expect(plain).toContain("blocked_cols");
    expect(plain).toContain("player.col");
    expect(plain).not.toContain("dcol");
  });

  it("changes only the instructions and the options: the state a model reads is the same", () => {
    expect(riskInstructions("routing", "hop_forward", "json")).toContain(MANUALS.routing);
  });
});
