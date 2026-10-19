import type { RoutePreview } from "@ccr/agent";
import { constantPolicy } from "@ccr/agent/testing";
import { type Action, Game } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { Session } from "../session.ts";
import { buildExecution } from "./execution.ts";
import { settle } from "./test-support.ts";

const detour: RoutePreview = {
  col: 0,
  steps: [
    { action: "hop_back", col: 0, dz: -1 },
    { action: "hop_right", col: 1, dz: -1 },
    { action: "hop_forward", col: 1, dz: 0 },
  ],
};

async function playing(action: Action, preview?: RoutePreview, held = false) {
  const s = new Session();
  s.setPolicy(
    constantPolicy(action, {
      ...(preview ? { preview } : {}),
      ...(held ? { sent: { model: "clef-flash", state: {}, questions: {} } } : {}),
    }),
  );
  if (held) s.setLinger(1000);
  s.start(1);
  s.frame(1 / 60);
  await settle();
  return s;
}

describe("live execution presentation", () => {
  it("highlights the wait before forward and makes the continuation conditional", async () => {
    const s = await playing("stay", {
      col: 0,
      conditional: true,
      steps: [
        { action: "stay", col: 0, dz: 0 },
        { action: "hop_forward", col: 0, dz: 1 },
      ],
    });
    const wait = buildExecution(s.state(), s.game.snapshot());
    expect(wait).toMatchObject({
      action: "stay",
      next: null,
      overlay: { active: true, waiting: true, conditional: true },
    });
    expect(wait.overlay?.points).toEqual([
      { x: 0, z: 8 },
      { x: 0, z: 8, wait: true },
      { x: -0, z: 9, wait: false },
    ]);
    const forward = await playing("hop_forward");
    expect(buildExecution(forward.state(), forward.game.snapshot())).toMatchObject({
      action: "hop_forward",
      overlay: { waiting: false, conditional: false },
    });
  });

  it("shows the actual back hop and the full world-anchored detour", async () => {
    const s = await playing("hop_back", detour);
    s.game.advance(5);
    const view = buildExecution(s.state(), s.game.snapshot());
    expect(view.action).toBe("hop_back");
    expect(view.overlay?.points).toEqual([
      { x: 0, z: s.game.snapshot().hero.z },
      { x: 0, z: 7 },
      { x: -1, z: 7, wait: false },
      { x: -1, z: 8, wait: false },
    ]);
  });

  it("previews a held answer without claiming that its first step is executing", async () => {
    const s = await playing("hop_back", detour, true);
    expect(buildExecution(s.state(), s.game.snapshot())).toMatchObject({
      action: null,
      next: "hop_back",
      overlay: { active: false },
    });
    expect(s.state().playback).toBeNull();
  });

  it("keeps the in-flight hop active while a different action is queued, then changes at landing", async () => {
    const s = await playing("hop_forward");
    s.game.act("hop_right");
    expect(buildExecution(s.state(), s.game.snapshot())).toMatchObject({
      action: "hop_forward",
      next: "hop_right",
    });
    s.game.advance(12);
    expect(buildExecution(s.state(), s.game.snapshot())).toMatchObject({
      action: "hop_right",
      next: null,
    });
  });

  it("discards a delayed forecast but still draws the actual snapshot target", async () => {
    const s = await playing("hop_back", detour);
    const state = s.state();
    if (!state.last) throw new Error("missing decision");
    const stale = { ...state, last: { ...state.last, observed: { tick: -12, row: 7 } } };
    const view = buildExecution(stale, s.game.snapshot());
    expect(view.action).toBe("hop_back");
    expect(view.overlay?.points).toEqual([
      { x: 0, z: 8 },
      { x: 0, z: 7 },
    ]);
  });

  it("drops the old continuation when the model is consulted again", async () => {
    const s = await playing("hop_back", detour);
    const view = buildExecution(
      {
        ...s.state(),
        asking: {
          input: { model: "clef-flash", state: {}, questions: {} },
          since: 0,
        },
      },
      s.game.snapshot(),
    );
    expect(view.action).toBe("hop_back");
    expect(view.overlay?.points).toHaveLength(2);
  });

  it("does not turn a blocked attempt into movement or draw its continuation", async () => {
    const s = await playing("hop_forward", detour);
    const snap = new Game({ seed: 1 }).snapshot();
    const state = { ...s.state(), playback: { index: 0, outcome: "blocked" as const } };
    expect(buildExecution(state, snap)).toEqual({
      action: null,
      next: null,
      blocked: true,
      overlay: null,
    });
  });

  it("follows a waiting chicken on a moving platform and freezes the pulse on pause", async () => {
    const s = await playing("stay", {
      col: 0.7,
      steps: [
        { action: "stay", col: 0.9, dz: 0 },
        { action: "hop_forward", col: 1, dz: 1 },
      ],
    });
    const snap = s.game.snapshot();
    const moved = { ...snap, tick: 5, hero: { ...snap.hero, x: -0.8 } };
    const view = buildExecution({ ...s.state(), paused: true }, moved);
    expect(view).toMatchObject({ action: "stay", overlay: { pulse: false } });
    expect(view.overlay?.points[1]).toEqual({ x: -0.8, z: 8, wait: true });
  });

  it("removes completed forecasts, and clears on retry, error, death and stall", async () => {
    const s = await playing("hop_back", detour);
    s.game.advance(12);
    expect(buildExecution(s.state(), s.game.snapshot()).overlay).toBeNull();
    for (const change of [{ phase: "error" as const }, { alive: false }, { stalled: true }])
      expect(buildExecution({ ...s.state(), ...change }, s.game.snapshot()).action).toBeNull();
    s.start(1);
    expect(buildExecution(s.state(), s.game.snapshot())).toEqual({
      action: null,
      next: null,
      blocked: false,
      overlay: null,
    });
  });
});
