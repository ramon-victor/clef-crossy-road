import { describe, expect, it } from "vitest";
import {
  controllerNote,
  controllerSays,
  controllerStep,
  leaveText,
  recordedSteps,
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
    expect(controllerStep(decision({ kind: "hold", why: "edge" }))).toEqual({
      kind: "hold",
      why: "edge",
    });
    expect(controllerStep(decision({ kind: "wait", n: 2, of: 15, cell: "vehicle" }))).toEqual({
      kind: "wait",
      n: 2,
      of: 15,
      cell: "vehicle",
      why: "gap",
    });
    expect(
      controllerStep(decision({ kind: "wait", n: 2, of: 15, cell: "train", why: "no_rest" })),
    ).toMatchObject({ cell: "train", why: "no_rest" });
    expect(controllerStep(decision({ kind: "walk", n: 1, left: 3 }))).toEqual({
      kind: "walk",
      n: 1,
      left: 3,
    });
    expect(controllerStep(decision({ kind: "leave", n: 2, left: 1 }))).toEqual({
      kind: "leave",
      n: 2,
      left: 1,
    });
  });

  it("does not know why a hold holds when it is not told, or told something else", () => {
    expect(controllerStep(decision({ kind: "hold" }))).toEqual({ kind: "hold", why: null });
    expect(controllerStep(decision({ kind: "hold", why: "bored" }))).toEqual({
      kind: "hold",
      why: null,
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
    expect(controllerStep(decision({ kind: "leave", n: 1 }))).toBeNull();
  });
});

describe("what the controller is doing, in words", () => {
  it("says what the crossing waits for, with the count", () => {
    const wait = (cell: string) => ({
      kind: "wait" as const,
      n: 3,
      of: 15,
      cell,
      why: "gap" as const,
    });
    expect(waitingText({ ...wait("vehicle"), of: 0 })).toBe("waiting for a vehicle to pass (3)");
    expect(waitingText(wait("vehicle"))).toBe("waiting for a vehicle to pass 3/15");
    expect(waitingText(wait("train_coming"))).toBe("waiting for the train to pass 3/15");
    expect(waitingText(wait("water"))).toBe("waiting for a log to come 3/15");
    expect(waitingText(wait("outside_world"))).toBe(
      "waiting for the cell to clear (outside world) 3/15",
    );
  });

  it("says why a cell that is clear is still waited for: what would reach it before the chicken could go on", () => {
    const rest = (cell: string) => ({
      kind: "wait" as const,
      n: 3,
      of: 15,
      cell,
      why: "no_rest" as const,
    });
    expect(waitingText(rest("vehicle"))).toBe(
      "the cell is clear, but a vehicle would reach it before the chicken could go on · waiting 3/15",
    );
    expect(waitingText(rest("train"))).toContain("the train would reach it");
  });

  it("says how far a detour has got, and a way off a platform", () => {
    expect(walkText({ kind: "walk", n: 2, left: 3 })).toBe("walking the detour: hop 2, 3 to go");
    expect(leaveText({ kind: "leave", n: 1, left: 2 })).toBe(
      "getting off the platform: hop 1, 2 to go",
    );
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
    expect(
      controllerSays({
        extra: { fallback: "detour_right", controller: { kind: "walk", n: 1, left: 3 } },
        note: "model chose cross_ahead; cross_ahead: refused, nothing moves on that row, the water stays; detour_right: hop 1, right (3 to go)",
      }),
    ).toBe(
      "refused, nothing moves on that row, the water stays; detour_right: hop 1, right (3 to go)",
    );
    expect(controllerSays(at({ kind: "leave", n: 1, left: 2 }))).toBe(
      "getting off the platform: hop 1, 2 to go",
    );
    expect(controllerSays({})).toBeNull();
  });
});

describe("waitsForGap", () => {
  const turn = (model: unknown, steps: unknown[] = []) =>
    ({ model: { decision: model }, steps: steps.map((decision) => ({ decision })) }) as never;

  it("is true when the controller's own first step waited, or a later one did", () => {
    expect(
      waitsForGap(
        turn({
          extra: { controller: { kind: "wait", n: 1, of: 15, cell: "water", why: "gap" } },
        }),
      ),
    ).toBe(true);
    expect(
      waitsForGap(
        turn({ extra: { ahead: "open" } }, [
          { extra: { controller: { kind: "wait", n: 2, of: 15, cell: "water", why: "gap" } } },
        ]),
      ),
    ).toBe(true);
  });

  it("is false for a crossing made at once, however the way ahead was answered, a closed one, and a detour", () => {
    expect(waitsForGap(turn({ extra: { ahead: "passing", controller: { kind: "hop" } } }))).toBe(
      false,
    );
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

it("folds equivalent recorded waits but preserves changes of reason, source and intervening hops", () => {
  const log = (index: number, why = "gap", source: "model" | "executor" = "executor") => ({
    index,
    tick: index,
    row: 1,
    action: "stay" as const,
    wallMs: 0,
    decision: {
      action: "stay" as const,
      source,
      notice: {
        kind: "waiting",
        maneuver: "cross_ahead",
        cell: "vehicle",
        waited: index,
        limit: 15,
      } as const,
      extra: { controller: { kind: "wait", n: index, of: 15, cell: "vehicle", why } },
    },
  });
  const waits = [
    log(1),
    log(2),
    log(3, "no_rest"),
    log(4, "no_rest", "model"),
    { ...log(5), action: "hop_forward" as const },
    log(6),
  ];
  const before = JSON.stringify(waits);
  expect(recordedSteps(waits).map(({ log, count }) => [log.index, count])).toEqual([
    [2, 2],
    [3, 1],
    [4, 1],
    [5, 1],
    [6, 1],
  ]);
  expect(JSON.stringify(waits)).toBe(before);
});
