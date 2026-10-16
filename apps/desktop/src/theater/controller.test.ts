import { describe, expect, it } from "vitest";
import {
  controllerNote,
  controllerSays,
  controllerStep,
  isPassing,
  waitingText,
  waitsForGap,
  walkText,
} from "./controller.ts";

const decision = (controller?: unknown, extra: Record<string, unknown> = {}) => ({
  extra: { ...(controller === undefined ? {} : { controller }), ...extra },
});

describe("controllerStep: the kind of step a decision was", () => {
  it("reads each kind with its numbers", () => {
    expect(controllerStep(decision({ kind: "hop" }))).toEqual({ kind: "hop" });
    expect(controllerStep(decision({ kind: "hold" }))).toEqual({ kind: "hold" });
    expect(controllerStep(decision({ kind: "wait", n: 2, of: 15, cell: "vehicle" }))).toEqual({
      kind: "wait",
      n: 2,
      of: 15,
      cell: "vehicle",
    });
    expect(controllerStep(decision({ kind: "walk", n: 1, left: 3 }))).toEqual({
      kind: "walk",
      n: 1,
      left: 3,
    });
  });

  it("has no step for a decision without a controller, or with a malformed report", () => {
    expect(controllerStep({})).toBeNull();
    expect(controllerStep(decision())).toBeNull();
    expect(controllerStep(decision("hop"))).toBeNull();
    expect(controllerStep(decision(null))).toBeNull();
    expect(controllerStep(decision({ kind: "dance" }))).toBeNull();
    expect(controllerStep(decision({ kind: "wait", n: "2", of: 15, cell: "vehicle" }))).toBeNull();
    expect(controllerStep(decision({ kind: "wait", n: 2, of: 15 }))).toBeNull();
    expect(controllerStep(decision({ kind: "walk", n: 1 }))).toBeNull();
    expect(controllerStep(decision({ kind: "walk", n: Number.NaN, left: 1 }))).toBeNull();
  });
});

describe("isPassing", () => {
  it("is the way ahead that opens when things pass, not an open or a closed one", () => {
    expect(isPassing(decision(undefined, { ahead: "passing" }))).toBe(true);
    expect(isPassing(decision(undefined, { ahead: "open" }))).toBe(false);
    expect(isPassing(decision(undefined, { ahead: "closed" }))).toBe(false);
    expect(isPassing({})).toBe(false);
  });
});

describe("what the controller is doing, in words", () => {
  it("says what the crossing waits for, with the count", () => {
    const wait = (cell: string) => ({ kind: "wait" as const, n: 3, of: 15, cell });
    expect(waitingText(wait("vehicle"))).toBe("waiting for a vehicle to pass 3/15");
    expect(waitingText(wait("train_coming"))).toBe("waiting for the train to pass 3/15");
    expect(waitingText(wait("water"))).toBe("waiting for a log to come 3/15");
    expect(waitingText(wait("outside_world"))).toBe("waiting for the outside world to clear 3/15");
  });

  it("says how far a detour has got", () => {
    expect(walkText({ kind: "walk", n: 2, left: 3 })).toBe("walking the detour: hop 2, 3 to go");
  });
});

describe("controllerNote", () => {
  it("drops the model's choice and the name of the manoeuvre, and keeps what the controller says", () => {
    expect(
      controllerNote({ note: "model chose cross_ahead; cross_ahead: the cell is clear, hopping" }),
    ).toBe("the cell is clear, hopping");
    expect(controllerNote({ note: "detour_right: hop 2, right (2 to go)" })).toBe(
      "hop 2, right (2 to go)",
    );
    expect(controllerNote({ note: "plain words" })).toBe("plain words");
  });

  it("has nothing to say without a note", () => {
    expect(controllerNote({})).toBeNull();
    expect(controllerNote({ note: "" })).toBeNull();
  });
});

describe("controllerSays", () => {
  const at = (controller: unknown, note?: string) => ({
    extra: { controller },
    ...(note === undefined ? {} : { note }),
  });

  it("says what a wait, a walk and a refusal are, and nothing of a plain hop", () => {
    expect(controllerSays(at({ kind: "wait", n: 2, of: 15, cell: "vehicle" }))).toBe(
      "waiting for a vehicle to pass 2/15",
    );
    expect(controllerSays(at({ kind: "walk", n: 1, left: 2 }))).toBe(
      "walking the detour: hop 1, 2 to go",
    );
    expect(
      controllerSays(at({ kind: "hold" }, "cross_ahead: refused, tree does not go away")),
    ).toBe("refused, tree does not go away");
    expect(
      controllerSays(at({ kind: "hop" }, "cross_ahead: the cell is clear, hopping")),
    ).toBeNull();
    expect(controllerSays({})).toBeNull();
  });
});

describe("waitsForGap", () => {
  const turn = (model: unknown, steps: unknown[] = []) =>
    ({ model: { decision: model }, steps: steps.map((decision) => ({ decision })) }) as never;

  it("is true when the way opens as things pass, or when the model's own step or a later one waited", () => {
    expect(waitsForGap(turn({ extra: { ahead: "passing" } }))).toBe(true);
    expect(
      waitsForGap(turn({ extra: { controller: { kind: "wait", n: 1, of: 15, cell: "water" } } })),
    ).toBe(true);
    expect(
      waitsForGap(
        turn({ extra: { ahead: "open" } }, [
          { extra: { controller: { kind: "wait", n: 2, of: 15, cell: "water" } } },
        ]),
      ),
    ).toBe(true);
  });

  it("is false for an open way, a closed one, and a detour", () => {
    expect(waitsForGap(turn({ extra: { ahead: "open", controller: { kind: "hop" } } }))).toBe(
      false,
    );
    expect(
      waitsForGap(
        turn({ extra: { ahead: "closed", controller: { kind: "walk", n: 1, left: 2 } } }, [
          { extra: { controller: { kind: "walk", n: 2, left: 1 } } },
        ]),
      ),
    ).toBe(false);
  });
});
