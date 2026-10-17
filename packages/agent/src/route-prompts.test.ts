import { describe, expect, it } from "vitest";
import { boxedIn, grass, scene, water, world } from "./route.testing.ts";
import {
  AROUND_CRITERIA,
  AROUND_OPTIONS,
  CELL_CRITERIA,
  MOVING_CRITERIA,
  RIDE_CRITERIA,
  routeQuestions,
} from "./route-prompts.ts";

describe("the lookup questions", () => {
  const questions = routeQuestions();

  it("are three, each a lookup of its own field with its own options, the same for every state", () => {
    expect(Object.keys(questions).sort()).toEqual(["around", "cell", "moving"]);
    expect(Object.keys(CELL_CRITERIA).sort()).toEqual(["no_stand", "stand"]);
    expect(Object.keys(MOVING_CRITERIA).sort()).toEqual(["moving", "still"]);
    expect(Object.keys(AROUND_CRITERIA).sort()).toEqual([...AROUND_OPTIONS].sort());
  });

  it("each of the first two reads one field, and says so", () => {
    expect(questions.cell?.instructions).toContain("Read only cross_ahead.lands_on");
    expect(questions.moving?.instructions).toContain("Read only cross_ahead.things_move");
  });

  it("only name entries and fields that the state has, and never say which move is good", () => {
    const state = scene(boxedIn()) as unknown as Record<string, Record<string, unknown>>;
    const text = Object.values(questions)
      .map((q) =>
        q.type === "choice"
          ? `${q.instructions} ${Object.values(q.criteria).join(" ")}`
          : q.instructions,
      )
      .join(" ");
    const found = [
      ...text.matchAll(
        /\b(cross_ahead|detour_left|detour_right|wait_here|chicken|memory)\.([a-z_]+)/g,
      ),
    ];
    expect(found.length).toBeGreaterThan(12);
    for (const [, entry, field] of found) {
      expect(Object.keys(state[entry ?? ""] ?? {}), `${entry}.${field}`).toContain(field);
    }
    expect(text).not.toMatch(/\bsafe\b|\bunsafe\b|danger|you should|best move/i);
  });

  it("add a fourth, that reads only the clock of the platform, when the chicken stands on one", () => {
    const riding = routeQuestions(true);
    expect(Object.keys(riding).sort()).toEqual(["around", "cell", "moving", "ride"]);
    expect(riding.ride?.instructions).toContain("Read only chicken.edge_in");
    expect(riding.ride?.instructions).toContain("chicken.edge_in a_moment -> leaving");
    expect(riding.ride?.instructions).toContain("chicken.edge_in soon -> staying");
    expect(Object.keys(RIDE_CRITERIA).sort()).toEqual(["leaving", "staying"]);
    // The three questions made off a platform are exactly what they were: nothing is added to their words.
    expect(riding.cell).toEqual(routeQuestions().cell);
    expect(riding.around).toEqual(routeQuestions().around);
  });

  it("only name fields the state has once the chicken stands on a platform, and say nothing of what to do", () => {
    const onLog = scene(
      world([grass([], -1), water([{ col: 3, speed: 3, type: "log", half: 1.6 }], 0)], 3, true),
    ) as unknown as Record<string, Record<string, unknown>>;
    const text = Object.values(routeQuestions(true))
      .map((q) =>
        q.type === "choice"
          ? `${q.instructions} ${Object.values(q.criteria).join(" ")}`
          : q.instructions,
      )
      .join(" ");
    for (const [, entry, field] of text.matchAll(
      /\b(cross_ahead|detour_left|detour_right|wait_here|chicken|memory)\.([a-z_]+)/g,
    )) {
      expect(Object.keys(onLog[entry ?? ""] ?? {}), `${entry}.${field}`).toContain(field);
    }
    expect(text).not.toMatch(/\bsafe\b|\bunsafe\b|danger|you should|best move/i);
    expect(text).not.toMatch(/\d/);
  });

  it("carry solved examples for each question", () => {
    expect(questions.cell?.instructions).toContain("lands_on lily_pad -> stand");
    expect(questions.cell?.instructions).toContain("lands_on water -> no_stand");
    expect(questions.moving?.instructions).toContain("things_move still -> still");
    expect(questions.around?.instructions).toContain("left none and right none -> wait_here");
  });
});
