import { constantPolicy } from "@ccr/agent/testing";
import { describe, expect, it } from "vitest";
import { LOCALES } from "../i18n/locale.ts";
import { translator } from "../i18n/translate.ts";
import { type Asking, Session } from "../session.ts";
import { buildCaption } from "./caption.ts";
import { controllerSays } from "./controller.ts";
import { buildExecution, type ExecutionView } from "./execution.ts";
import { FRAME, settle } from "./test-support.ts";

const empty: ExecutionView = { action: null, next: null, blocked: false, overlay: null };

async function waiting(cell = "water", why = "gap") {
  const session = new Session({ decisionTicks: 1 });
  session.setPolicy(
    constantPolicy("stay", {
      source: "executor",
      extra: { controller: { kind: "wait", n: 1, of: 15, cell, why } },
    }),
  );
  session.start(1);
  session.frame(FRAME);
  await settle();
  return session;
}

describe("compact game caption", () => {
  it("keeps the wait's reason across the real step boundary without extending execution", async () => {
    const s = await waiting();
    const renderedState = s.state();
    const before = buildCaption(renderedState, buildExecution(renderedState, s.game.snapshot()));
    expect(before?.text).toBe("Waiting for a log");
    s.frame(FRAME);
    const execution = buildExecution(s.state(), s.game.snapshot());
    expect(execution.action).toBeNull();
    expect(s.state().phase).toBe("idle");
    expect(buildCaption(s.state(), execution)?.text).toBe(before?.text);
    // Execution updates every frame; the App's session snapshot may still say "hopping".
    expect(buildCaption(renderedState, execution)?.text).toBe(before?.text);
    expect(controllerSays(s.state().last?.decision ?? {})).toBe("waiting for a log to come 1/15");
  });

  it.each([
    ["vehicle", "gap", "Waiting for a vehicle to pass"],
    ["train", "gap", "Waiting for the train to pass"],
    ["train_coming", "gap", "Waiting for the train to pass"],
    ["vehicle", "no_rest", "Waiting for room to continue"],
    ["unseen", "gap", "Waiting for the way to clear"],
  ])("explains %s / %s without a step counter", async (cell, why, message) => {
    const s = await waiting(cell, why);
    expect(buildCaption(s.state(), { ...empty, action: "stay" })?.text).toBe(message);
  });

  it("immediately replaces old waits with movement, queued actions, consultations, blocks and pause", async () => {
    const s = await waiting();
    s.frame(FRAME);
    const state = s.state();
    expect(buildCaption(state, { ...empty, action: "hop_forward" })?.text).toBe("Now: forward");
    expect(buildCaption(state, { ...empty, next: "hop_right" })?.text).toBe("next: right");
    expect(buildCaption({ ...state, phase: "reading" }, { ...empty, next: "stay" })?.text).toBe(
      "next: wait",
    );
    expect(buildCaption(state, { ...empty, blocked: true })?.text).toBe("Move blocked");
    expect(buildCaption({ ...state, paused: true }, empty)?.text).toBe("Paused · Space to resume");
    const asking: Asking = { input: { model: "clef-flash", state: {}, questions: {} }, since: 0 };
    expect(buildCaption({ ...state, asking }, empty)?.text).toBe("Reading the scene");
    expect(
      buildCaption({ ...state, asking }, { ...empty, action: "hop_back", next: "hop_right" }),
    ).toMatchObject({ text: "Now: back", context: "next: right" });
    expect(buildCaption({ ...state, asking }, { ...empty, action: "hop_back" })).toMatchObject({
      text: "Now: back",
      context: "Reading the scene",
    });
  });

  it("never bridges an unreleased, queued or unrelated playback record", async () => {
    const s = await waiting();
    s.frame(FRAME);
    const state = s.state();
    for (const playback of [
      null,
      { index: -1, outcome: "stay" as const },
      { index: 0, outcome: "queued" as const },
    ])
      expect(buildCaption({ ...state, playback }, empty)?.text).toBe("Awaiting next action");
    const held = buildCaption({ ...state, phase: "reading" }, { ...empty, next: "stay" });
    expect(held?.text).toBe("next: wait");
    expect(held?.strip).toHaveLength(0);
  });

  it("clears on error, death, stall, human control and a new episode", async () => {
    const s = await waiting();
    for (const change of [
      { phase: "error" as const },
      { alive: false },
      { stalled: true },
      { human: true },
    ])
      expect(buildCaption({ ...s.state(), ...change }, { ...empty, action: "stay" })).toBeNull();
    s.start(1);
    expect(buildCaption(s.state(), empty)).toBeNull();
  });

  it("says who made the live move, and that nobody stepped in when the chicken was left on a cell it cannot hold", async () => {
    const play = async (decision: Record<string, unknown>) => {
      const session = new Session({ decisionTicks: 1 });
      session.setPolicy(constantPolicy("stay", decision));
      session.start(1);
      session.frame(FRAME);
      await settle();
      return session.state();
    };
    const exposed = await play({
      source: "model",
      extra: { maneuver: "wait_here", controller: { kind: "hold", why: "exposed" } },
    });
    expect(buildCaption(exposed, { ...empty, action: "stay" })).toMatchObject({
      text: "Nothing stepped in: it stays on a cell that can't hold it",
      unaided: true,
      by: null,
    });
    const drifting = await play({
      source: "model",
      extra: { maneuver: "wait_here", controller: { kind: "hold", why: "edge" } },
    });
    expect(buildCaption(drifting, { ...empty, action: "stay" })?.text).toBe(
      "Nothing stepped in: the platform carries it off the map",
    );
    const refused = await play({
      source: "model",
      extra: { maneuver: "cross_ahead", controller: { kind: "hold", why: "refused" } },
    });
    expect(buildCaption(refused, { ...empty, action: "stay" })).toMatchObject({
      by: { who: "controller", label: "Controller" },
      unaided: false,
    });
    const dodge = await play({
      source: "model",
      extra: { maneuver: "step_off", controller: { kind: "dodge", left: 1 } },
    });
    expect(buildCaption(dodge, { ...empty, action: "hop_back" })).toMatchObject({
      by: { who: "model", label: "Clef" },
      unaided: false,
    });
  });

  it("shows reference actions without inventing a model choice and retranslates without changing records", async () => {
    const s = await waiting();
    const state = s.state();
    const before = JSON.stringify(state);
    const messages = new Set<string>();
    for (const locale of LOCALES) {
      const view = buildCaption(state, { ...empty, action: "stay" }, translator(locale));
      expect(view?.context).toBeNull();
      messages.add(view?.text ?? "");
      expect(view?.strip).toEqual(buildCaption(state, { ...empty, action: "stay" })?.strip);
    }
    expect(messages.size).toBe(LOCALES.length);
    expect(JSON.stringify(state)).toBe(before);
  });
});
