import type { Action } from "@ccr/core";
import { describe, expect, it } from "vitest";
import type { SessionState } from "../session.ts";
import { buildCompass, STRIP_MOVES, stripOf, winnerOf } from "./compass.ts";
import { answeredSession, readingSession, routeAnswers } from "./test-support.ts";

describe("buildCompass: the five moves around the chicken", () => {
  it("is hidden before the model has been asked anything", () => {
    const s = readingSession(routeAnswers("stand", "still", "wait_here"));
    s.start(4);
    expect(buildCompass(s.state())).toMatchObject({ mode: "hidden", moves: [], verdict: null });
  });

  it("shows all five moves with no confidence yet while the model reads", () => {
    const s = readingSession(routeAnswers("no_stand", "still", "detour_right", 0.1));
    const view = buildCompass(s.state());
    expect(view.mode).toBe("reading");
    expect(view.moves.map((m) => m.action).sort()).toEqual(
      ["hop_back", "hop_forward", "hop_left", "hop_right", "stay"].sort(),
    );
    expect(view.moves.every((m) => m.p === null && !m.winner)).toBe(true);
    expect(view.since).toEqual(expect.any(Number));
    expect(view.go).toBe(false);
  });

  it("sizes each move by the joint probability the code folds from the three answers", async () => {
    const s = await answeredSession(routeAnswers("no_stand", "still", "detour_right", 0.1));
    const view = buildCompass(s.state());
    const p = Object.fromEntries(view.moves.map((m) => [m.action, m.p]));
    // pCross = 0.1 + 0.9 * 0.5 = 0.55; the way is closed only if the second answer says still, but the
    // joint is the code's own arithmetic over the model's probabilities, so check it against the source.
    const recorded = s.state().lastModel?.decision.probabilities;
    expect(p).toEqual(
      Object.fromEntries(Object.entries(recorded ?? {}).map(([action, v]) => [action, v])),
    );
    expect(Object.values(p).reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBeCloseTo(1, 1);
  });

  it("lights the manoeuvre the model chose, not the move the controller starts with", async () => {
    const s = await answeredSession(routeAnswers("no_stand", "still", "detour_right", 0.1));
    const real = s.state();
    const log = real.lastModel;
    if (!log) throw new Error("expected the model to have answered");
    expect(winnerOf(log)).toBe("hop_right");

    // A detour from a spot boxed in begins by stepping back: the decision's own action is then "back",
    // and the model's choice is still "right".
    const stepsBack = { ...log, action: "hop_back" as const };
    expect(winnerOf(stepsBack)).toBe("hop_right");
    const view = buildCompass({ ...real, lastModel: stepsBack });
    expect(view.moves.filter((m) => m.winner).map((m) => m.action)).toEqual(["hop_right"]);
    expect(view.verdict).toBe("Detour right");
    expect(view.answers.map((a) => a.short)).toEqual(["No", "Still", "Right"]);
  });

  it("falls back to the move itself when there was no manoeuvre", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "detour_left", 0.9), 1);
    const log = s.state().lastModel;
    if (!log) throw new Error("expected the model to have answered");
    const { extra: _drop, ...plain } = log.decision;
    const noManeuver = { ...log, action: "hop_left" as const, decision: plain };
    expect(winnerOf(noManeuver)).toBe("hop_left");
  });

  it("marks the answers the routing never looked at", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "detour_left", 0.9), 1);
    const view = buildCompass(s.state());
    expect(view.answers.map((a) => a.skipped)).toEqual([false, true, true]);
    expect(view.moves.find((m) => m.winner)?.action).toBe("hop_forward");
  });

  it("lets the winner go once the move is released, and not while it is held for reading", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "detour_left", 0.9), 1);
    expect(buildCompass(s.state()).go).toBe(true);

    let clock = 0;
    const held = (await import("../session.ts")).Session;
    const slow = new held({ now: () => clock });
    const { clefPolicy, DEFAULT_CLEF } = await import("@ccr/agent");
    const { clientAnswering } = await import("./test-support.ts");
    slow.setLinger(1000);
    slow.setPolicy(
      clefPolicy(clientAnswering(routeAnswers("stand", "still", "wait_here", 0.9)), DEFAULT_CLEF),
    );
    slow.start(1);
    slow.frame(1 / 60);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(slow.state().phase).toBe("reading");
    expect(buildCompass(slow.state())).toMatchObject({ mode: "answered", go: false });
    clock = 1000;
    slow.frame(1 / 60);
    expect(buildCompass(slow.state()).go).toBe(true);
  });

  it("keeps the latest moves for the strip, the model's big and the controller's small", async () => {
    const s = await answeredSession(routeAnswers("no_stand", "still", "detour_right", 0.1), 4, 2);
    const { strip } = buildCompass(s.state());
    expect(strip.length).toBeGreaterThanOrEqual(3);
    expect(strip.length).toBeLessThanOrEqual(STRIP_MOVES);
    expect(strip[0]?.big).toBe(true);
    expect(strip.slice(1).every((chip) => !chip.big)).toBe(true);
  });

  it("is hidden once the game is over", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "detour_left", 0.9), 1);
    const dead = { ...s.state(), alive: false };
    expect(buildCompass(dead).mode).toBe("hidden");
    expect(buildCompass({ ...s.state(), stalled: true }).mode).toBe("hidden");
  });

  it("has nothing to draw when the strategy reports no probabilities", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "detour_left", 0.9), 1);
    const log = s.state().lastModel;
    if (!log) throw new Error("expected the model to have answered");
    const { probabilities: _gone, ...bare } = log.decision;
    const state = { ...s.state(), lastModel: { ...log, decision: bare } };
    expect(buildCompass(state).mode).toBe("hidden");
  });
});

/** The state of a session whose model has answered `answers`, with its latest decision swapped for `latest`. */
async function withLatest(
  latest: (log: NonNullable<SessionState["lastModel"]>) => SessionState["last"],
  answers = routeAnswers("stand", "still", "detour_left", 0.9),
  seed = 1,
) {
  const s = await answeredSession(answers, seed);
  const real = s.state();
  const log = real.lastModel;
  if (!log) throw new Error("expected the model to have answered");
  const last = latest(log);
  return { real, log, state: { ...real, last } as SessionState };
}

const stepOf = (
  log: NonNullable<SessionState["lastModel"]>,
  action: Action,
  controller: unknown,
  note?: string,
) => ({
  ...log,
  index: log.index + 1,
  action,
  decision: {
    action,
    source: "executor" as const,
    extra: { controller },
    ...(note === undefined ? {} : { note }),
  },
});

describe("buildCompass: what the chicken is doing about the choice", () => {
  it("lets the choice leave when the crossing is made", async () => {
    const { state } = await withLatest((log) => ({
      ...log,
      decision: { ...log.decision, extra: { ...log.decision.extra, controller: { kind: "hop" } } },
    }));
    expect(buildCompass(state)).toMatchObject({
      go: true,
      launch: true,
      waiting: false,
      actual: null,
      doing: null,
    });
  });

  it("lets it leave too when there is no controller at all: the move is simply made", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "detour_left", 0.9), 1);
    const real = s.state();
    const log = real.lastModel;
    if (!log) throw new Error("expected the model to have answered");
    const { extra: _drop, ...plain } = log.decision;
    const view = buildCompass({
      ...real,
      lastModel: { ...log, decision: plain },
      last: { ...log, decision: plain },
    });
    expect(view).toMatchObject({ launch: true, waiting: false, actual: null });
  });

  it("keeps the choice, pulsing, while the crossing waits for a gap, and says what for", async () => {
    const { state, log } = await withLatest((log) =>
      stepOf(log, "stay", { kind: "wait", n: 2, of: 15, cell: "vehicle" }),
    );
    const view = buildCompass(state);
    expect(view).toMatchObject({
      go: true,
      launch: false,
      waiting: true,
      actual: null, // a wait is part of "go straight", not another move
      doing: "waiting for a vehicle to pass 2/15",
    });
    expect(view.moves.find((m) => m.winner)?.action).toBe(winnerOf(log));
  });

  it("rings the hop of a detour it walks, and keeps the side it chose as the destination", async () => {
    const { state } = await withLatest(
      (log) => stepOf(log, "hop_back", { kind: "walk", n: 1, left: 3 }),
      routeAnswers("no_stand", "still", "detour_right", 0.1),
      4,
    );
    const view = buildCompass(state);
    expect(view).toMatchObject({
      launch: false,
      waiting: false,
      actual: "hop_back",
      doing: "walking the detour: hop 1, 3 to go",
    });
    expect(view.moves.find((m) => m.winner)?.action).toBe("hop_right");
  });

  it("rings the move of a refusal and says why", async () => {
    const { state } = await withLatest((log) =>
      stepOf(
        log,
        "hop_right",
        { kind: "hold" },
        "cross_ahead: refused, tree does not go away; stepping off a cell it cannot stay on: right (1 to go)",
      ),
    );
    expect(buildCompass(state)).toMatchObject({
      launch: false,
      waiting: false,
      actual: "hop_right",
      doing:
        "refused, tree does not go away; stepping off a cell it cannot stay on: right (1 to go)",
    });
  });

  it("does not take a step that is the choice itself for a divergence", async () => {
    // The model chose to go straight; the controller's step is that very hop: nothing to ring.
    const { state } = await withLatest((log) => stepOf(log, "hop_forward", { kind: "hop" }));
    expect(buildCompass(state)).toMatchObject({ launch: true, actual: null, doing: null });
  });

  it("says nothing of the controller while the answer is still held for reading", async () => {
    let clock = 0;
    const { Session } = await import("../session.ts");
    const { clefPolicy, DEFAULT_CLEF } = await import("@ccr/agent");
    const { clientAnswering } = await import("./test-support.ts");
    const held = new Session({ now: () => clock });
    held.setLinger(1000);
    held.setPolicy(
      clefPolicy(clientAnswering(routeAnswers("stand", "still", "wait_here", 0.9)), DEFAULT_CLEF),
    );
    held.start(1);
    held.frame(1 / 60);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(buildCompass(held.state())).toMatchObject({
      go: false,
      launch: false,
      waiting: false,
      actual: null,
      doing: null,
    });
    clock = 1000;
    held.frame(1 / 60);
    expect(buildCompass(held.state())).toMatchObject({ go: true, launch: true, actual: null });
  });

  it("calls a crossing 'when clear' when the way opens only as things pass, or when it had to wait", async () => {
    const plain = await withLatest((log) => log);
    expect(buildCompass(plain.state).verdict).toBe("Go straight");

    const passing = await withLatest((log) => log);
    const model = {
      ...passing.log,
      decision: {
        ...passing.log.decision,
        extra: { ...passing.log.decision.extra, ahead: "passing" },
      },
    };
    const viaAnswers = buildCompass({
      ...passing.state,
      lastModel: model,
      last: model,
      turns: [{ model, steps: [] }],
    });
    expect(viaAnswers.verdict).toBe("Go straight · when clear");

    // Open on the words, but the controller found a vehicle and waited: it is still "when clear".
    const waited = stepOf(plain.log, "stay", { kind: "wait", n: 1, of: 15, cell: "vehicle" });
    const viaWait = buildCompass({
      ...plain.state,
      last: waited,
      turns: [{ model: plain.log, steps: [waited] }],
    });
    expect(viaWait.verdict).toBe("Go straight · when clear");
  });
});

describe("stripOf: the latest moves under the game", () => {
  const entry = (
    index: number,
    action: Action,
    source: "model" | "executor",
    controller?: unknown,
  ) =>
    ({
      index,
      action,
      decision: { action, source, ...(controller === undefined ? {} : { extra: { controller } }) },
    }) as never;

  it("folds a run of waits for a gap into one chip with the count", () => {
    const wait = { kind: "wait", n: 1, of: 15, cell: "vehicle" };
    const chips = stripOf([
      entry(0, "stay", "model", wait), // the model's own decision is its own chip
      entry(1, "stay", "executor", wait),
      entry(2, "stay", "executor", wait),
      entry(3, "stay", "executor", wait),
      entry(4, "hop_forward", "executor", { kind: "hop" }),
    ]);
    expect(chips.map((c) => [c.glyph, c.big, c.count])).toEqual([
      ["•", true, 1],
      ["•", false, 3],
      ["↑", false, 1],
    ]);
  });

  it("does not fold waits that are not in one run, nor moves that are not waits", () => {
    const wait = { kind: "wait", n: 1, of: 15, cell: "vehicle" };
    const chips = stripOf([
      entry(0, "stay", "executor", wait),
      entry(1, "hop_left", "executor", { kind: "walk", n: 1, left: 2 }),
      entry(2, "stay", "executor", wait),
    ]);
    expect(chips.map((c) => c.count)).toEqual([1, 1, 1]);
  });

  it("keeps only the latest few chips", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      entry(i, i % 2 ? "hop_left" : "hop_right", "executor", { kind: "walk", n: i, left: 1 }),
    );
    expect(stripOf(many)).toHaveLength(STRIP_MOVES);
  });
});
