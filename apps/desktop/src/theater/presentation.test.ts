import { describe, expect, it } from "vitest";
import type { DecisionLog, SessionState } from "../session.ts";
import { buildDecisionPresentation } from "./presentation.ts";
import { answeredSession, readingSession, routeAnswers } from "./test-support.ts";

async function fixture() {
  const session = await answeredSession(routeAnswers("stand", "still", "wait_here"));
  const state = session.state();
  const original = state.turns[0]?.model;
  if (!original) throw new Error("Missing model answer");
  const model: DecisionLog = {
    ...original,
    decision: {
      ...original.decision,
      extra: { ...original.decision.extra, maneuver: "cross_ahead" },
    },
  };
  const wait: DecisionLog = {
    ...model,
    index: model.index + 1,
    action: "stay",
    decision: {
      action: "stay",
      source: "executor",
      extra: { controller: { kind: "wait", n: 2, of: 15, cell: "vehicle", why: "gap" } },
    },
  };
  return {
    state: {
      ...state,
      last: wait,
      lastModel: model,
      turns: [{ model, steps: [wait] }],
    } satisfies SessionState,
    model,
    wait,
  };
}

describe("decision presentation", () => {
  it("shows the model's intended direction separately from the controller's current wait", async () => {
    const { state } = await fixture();
    const view = buildDecisionPresentation(state, "model");
    expect(view.intent).toBe("hop_forward");
    expect(view.actual).toBe("stay");
    expect(view.title).toBe("Waiting here");
    expect(view.explanation).toBe("Waiting for the way to clear.");
    expect(view.controller).toBe(true);
    expect(view.answers.map((answer) => answer.id)).toEqual(["cell"]);
  });

  it("does not claim a move was sent while its answer is held for reading", async () => {
    const { state, model } = await fixture();
    const view = buildDecisionPresentation(
      { ...state, phase: "reading", last: model, turns: [{ model, steps: [] }] },
      "model",
    );
    expect(view.stage).toBe("holding");
    expect(view.intent).toBe("hop_forward");
    expect(view.actual).toBeNull();
    expect(view.title).toBe("Ready to move");
  });

  it("does not reuse an older action while a new request is reading", async () => {
    const state = readingSession(routeAnswers("stand", "still", "wait_here")).state();
    const view = buildDecisionPresentation(state, "model");
    expect(view.stage).toBe("reading");
    expect(view.intent).toBeNull();
    expect(view.actual).toBeNull();
    expect(view.answers).toEqual([]);
  });

  it("keeps the newest actual controller action after the retained step buffer stops growing", async () => {
    const { state, wait } = await fixture();
    const last = { ...wait, index: 99, action: "hop_left" as const };
    const view = buildDecisionPresentation({ ...state, last }, "model");
    expect(view.current?.index).toBe(99);
    expect(view.actual).toBe("hop_left");
    expect(state.turns[0]?.steps).toHaveLength(1);
  });

  it("keeps an older consultation's action when a newer round has arrived", async () => {
    const { state, model } = await fixture();
    const next = { ...model, index: 100, action: "hop_right" as const };
    const view = buildDecisionPresentation(
      {
        ...state,
        last: next,
        lastModel: next,
        turns: [...state.turns, { model: next, steps: [] }],
      },
      "model",
      undefined,
      model.index,
    );
    expect(view.actual).toBe("stay");
    expect(view.current?.index).not.toBe(100);
  });

  it.each([{ alive: false, deathCause: "car" as const }, { paused: true }, { error: "failure" }])(
    "keeps historical actions readable after the game status changes: %j",
    async (status) => {
      const { state, model } = await fixture();
      const next = { ...model, index: 100, action: "hop_right" as const };
      const view = buildDecisionPresentation(
        {
          ...state,
          ...status,
          last: next,
          lastModel: next,
          turns: [...state.turns, { model: next, steps: [] }],
        },
        "model",
        undefined,
        model.index,
      );
      expect(view.stage).toBe("acting");
      expect(view.title).toBe("Waiting here");
      expect(view.actual).toBe("stay");
    },
  );

  it("labels stopped and non-model states without manufacturing model choices", async () => {
    const { state } = await fixture();
    expect(buildDecisionPresentation({ ...state, paused: true }, "model").stage).toBe("paused");
    expect(
      buildDecisionPresentation({ ...state, alive: false, deathCause: "car" }, "model").stage,
    ).toBe("ended");
    expect(buildDecisionPresentation({ ...state, error: "failure" }, "model").stage).toBe("error");
    const reference = buildDecisionPresentation(state, "reference");
    expect(reference.intent).toBeNull();
    expect(reference.actual).toBe("stay");
    expect(reference.rounds).toEqual([]);
    expect(buildDecisionPresentation(state, "human").current).toBeNull();
  });
});
