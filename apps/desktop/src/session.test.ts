import {
  alwaysForward,
  DEFAULT_STALL_LIMIT,
  type Decision,
  type Memory,
  type PolicyFactory,
  playEpisode,
} from "@ccr/agent";
import { constantPolicy } from "@ccr/agent/testing";
import { type Action, Game } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { Session, type SessionEvent } from "./session.ts";

const FRAME = 1 / 60;

function run(session: Session, seconds: number): void {
  for (let t = 0; t < seconds; t += FRAME) session.frame(FRAME);
}

/** Lets pending promise callbacks run, without waiting for a timer. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** Plays frames, letting answers arrive in between, until `done` or the frame budget runs out. */
async function runUntil(session: Session, done: () => boolean, maxFrames = 4000): Promise<void> {
  for (let i = 0; i < maxFrames && !done(); i++) {
    session.frame(FRAME);
    await settle();
  }
}

/** A model-like policy whose answers are given by the test, so no real time passes. */
function controlledPolicy() {
  const waiting: Array<(decision: Decision) => void> = [];
  const factory: PolicyFactory = {
    id: "controlled",
    create: () => ({
      kind: "observation",
      id: "controlled",
      decide: () => new Promise<Decision>((resolve) => waiting.push(resolve)),
    }),
  };
  return {
    factory,
    asked: () => waiting.length,
    async answer(decision: Decision = { action: "hop_forward" }) {
      waiting.shift()?.(decision);
      await settle();
    },
  };
}

describe("Session: human control", () => {
  it("suspends a queued single step when explicitly paused, as on window minimization", async () => {
    const controlled = controlledPolicy();
    const session = new Session();
    session.setPolicy(controlled.factory, 1);
    session.setPaused(true);
    session.stepOnce();
    session.setPaused(true);
    run(session, 1);
    await settle();
    expect(controlled.asked()).toBe(0);
    expect(session.state()).toMatchObject({ tick: 0, paused: true, decisions: 0 });
    session.setPaused(false);
    session.frame(FRAME);
    expect(controlled.asked()).toBe(1);
  });

  it("accounts for an in-flight answer while paused without starting another turn", async () => {
    const controlled = controlledPolicy();
    const session = new Session();
    session.setPolicy(controlled.factory, 1);
    session.frame(FRAME);
    session.setPaused(true);
    const tick = session.state().tick;
    await controlled.answer({ action: "hop_forward", neurons: 2 });
    run(session, 1);
    expect(session.state()).toMatchObject({ tick, paused: true, decisions: 1, neurons: 2 });
    expect(controlled.asked()).toBe(0);
  });

  it("runs the world and applies key input immediately", () => {
    const s = new Session();
    s.start(7);
    s.humanInput("hop_forward");
    run(s, 0.5);
    expect(s.game.score).toBe(1);
    expect(s.state().human).toBe(true);
  });

  it("holding forward plays exactly like hopping forward one hop at a time", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = new Session();
      s.start(seed);
      for (let frame = 0; frame < 20 * 60 && s.game.alive; frame++) {
        s.humanInput("hop_forward"); // a key repeat on every frame, far faster than a hop
        s.frame(FRAME);
      }
      const stepped = new Game({ seed });
      while (stepped.alive && stepped.tick < s.game.tick) stepped.step("hop_forward");
      expect(s.game.score, `seed ${seed}`).toBe(stepped.score);
      expect(s.game.deathCause, `seed ${seed}`).toBe(stepped.deathCause);
    }
  });

  it("ignores input while paused and while a policy is playing", () => {
    const s = new Session();
    s.start(7);
    s.setPaused(true);
    s.humanInput("hop_forward");
    run(s, 0.5);
    expect(s.game.score).toBe(0);

    s.setPaused(false);
    s.setPolicy(alwaysForward);
    s.humanInput("hop_left");
    expect(s.game.heroX).toBe(0);
  });
});

/** A policy that records what it was shown and plays a fixed move. */
function spyOn(action: Action) {
  const seen: Array<{ obs: unknown; memory: Memory | undefined }> = [];
  const factory: PolicyFactory = {
    id: "spy",
    create: () => ({
      kind: "observation",
      id: "spy",
      decide: async (obs, memory) => {
        seen.push({ obs, memory });
        return { action };
      },
    }),
  };
  return { factory, seen };
}

describe("Session: what the policy remembers", () => {
  it("shows a policy the same observations and memory as the benchmark runner does", async () => {
    // Same moves on the same seed: this is what lets the app replay the benchmark's cached answers.
    const viaRunner = spyOn("hop_right");
    await playEpisode(viaRunner.factory, 1, { maxDecisions: 6, stallLimit: 0 });

    const viaSession = spyOn("hop_right");
    const s = new Session();
    s.setPolicy(viaSession.factory);
    s.start(1);
    await runUntil(s, () => viaSession.seen.length >= 6, 4000);

    expect(viaSession.seen.slice(0, 6)).toEqual(viaRunner.seen);
    expect(viaSession.seen[5]?.memory?.recent.every((m) => m.outcome === "blocked")).toBe(true);
  });

  it("starts every game with an empty memory", async () => {
    const spy = spyOn("hop_forward");
    const s = new Session();
    s.setPolicy(spy.factory);
    s.start(3);
    await runUntil(s, () => spy.seen.length >= 3, 2000);
    s.start(3);
    spy.seen.length = 0;
    await runUntil(s, () => spy.seen.length >= 1, 1000);
    expect(spy.seen[0]?.memory).toEqual({
      recent: [],
      score: 0,
      sinceProgress: 0,
      behindFrontier: 0,
    });
  });
});

describe("Session: events for the terminal log", () => {
  it("says when a game starts, each decision a policy makes, and when it ends", async () => {
    const events: SessionEvent[] = [];
    const s = new Session();
    s.subscribeEvents((e) => events.push(e));
    s.setPolicy(alwaysForward, 11);
    await runUntil(s, () => !s.game.alive, 4000);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("start");
    expect(types.filter((t) => t === "start")).toHaveLength(1);
    expect(types.at(-1)).toBe("end");
    expect(types.filter((t) => t === "end")).toHaveLength(1); // said once, however often it is checked
    const decisions = events.filter((e) => e.type === "decision");
    expect(decisions.length).toBe(s.state().decisions);
    expect(events[0]).toMatchObject({ seed: 11, policyId: "always-forward", timing: "step" });
    expect(events.at(-1)).toMatchObject({ type: "end", state: { alive: false, seed: 11 } });
  });

  it("starts the new game on the seed it was given and tells a new listener nothing about the past", () => {
    const s = new Session();
    s.setPolicy(alwaysForward, 5);
    const events: SessionEvent[] = [];
    const stop = s.subscribeEvents((e) => events.push(e));
    s.start(9);
    stop();
    s.start(10);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "start", seed: 9 });
    expect(s.state().seed).toBe(10);
  });

  it("does not send decisions for a person at the keyboard, but starts and ends", () => {
    const s = new Session();
    const events: SessionEvent[] = [];
    s.subscribeEvents((e) => events.push(e));
    s.start(7);
    s.humanInput("hop_forward");
    run(s, 0.5);
    expect(events.map((e) => e.type)).toEqual(["start"]);
    expect(events[0]).toMatchObject({ policyId: null });
  });

  it("reports a game that stalls as an end, once", async () => {
    const spy = spyOn("stay");
    const s = new Session();
    s.setSpeed(8);
    s.setPolicy(spy.factory, 3);
    const events: SessionEvent[] = [];
    s.subscribeEvents((e) => events.push(e));
    await runUntil(s, () => s.state().stalled, 8000);
    await runUntil(s, () => false, 60);
    expect(events.filter((e) => e.type === "end")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "end", state: { stalled: true, alive: true } });
  });
});

describe("Session: what the model read", () => {
  it("keeps what each decision was sent, for the inspector, for the recent decisions", async () => {
    const sent = { model: "clef-flash", state: "map", questions: {} } as const;
    const factory: PolicyFactory = {
      id: "asks",
      create: () => ({
        kind: "observation",
        id: "asks",
        decide: async () => ({ action: "stay", sent }),
      }),
    };
    const s = new Session();
    s.setPolicy(factory);
    s.start(3);
    await runUntil(s, () => s.state().decisions >= 3, 2000);
    const { history, last } = s.state();
    expect(last?.decision.sent).toEqual(sent);
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history.every((h) => h.decision.sent !== undefined)).toBe(true);
  });
});

describe("Session: a policy that gets nowhere", () => {
  it("ends the game after the benchmark's stall limit and then stops asking", async () => {
    const spy = spyOn("stay");
    const s = new Session();
    s.setSpeed(8);
    s.setPolicy(spy.factory);
    s.start(3);
    await runUntil(s, () => s.state().stalled, 8000);
    expect(s.state()).toMatchObject({ stalled: true, alive: true, decisions: DEFAULT_STALL_LIMIT });

    const asked = spy.seen.length;
    const tick = s.game.tick;
    await runUntil(s, () => false, 120);
    expect(spy.seen.length).toBe(asked); // nothing more to ask, nothing more to spend
    expect(s.game.tick).toBe(tick); // and the world stands still

    s.start(3);
    expect(s.state().stalled).toBe(false);
  });

  it("does not end a game in which the policy keeps reaching new rows, and never ends a human's", async () => {
    const s = new Session();
    s.setPolicy(alwaysForward);
    s.start(11);
    await runUntil(s, () => !s.game.alive, 4000);
    expect(s.state().stalled).toBe(false);

    s.setPolicy(null);
    run(s, 5);
    expect(s.state()).toMatchObject({ stalled: false, human: true });
  });
});

describe("Session: AI in step timing", () => {
  it("freezes the world, and asks once, while the policy thinks; then plays the hop out", async () => {
    const policy = controlledPolicy();
    const s = new Session();
    s.setPolicy(policy.factory);
    s.start(3);

    run(s, 0.3);
    expect(s.state().phase).toBe("thinking");
    expect(policy.asked()).toBe(1);
    expect(s.game.tick).toBe(0); // the world did not move while waiting

    await policy.answer({ action: "hop_forward" });
    expect(s.state().phase).toBe("hopping");
    run(s, 0.5);
    expect(s.game.tick).toBeGreaterThanOrEqual(12);
    expect(s.state().decisions).toBe(1);
    expect(s.state().last?.action).toBe("hop_forward");
    expect(policy.asked()).toBe(1); // the hop is over, so it asks for the next move
  });

  it("matches the benchmark: one decision per 12-tick hop, same result as Game.step", async () => {
    const s = new Session();
    s.setPolicy(alwaysForward);
    s.start(11);
    await runUntil(s, () => !s.game.alive);
    const reference = new Game({ seed: 11 });
    for (let i = 0; i < s.state().decisions; i++) reference.step("hop_forward");
    expect(s.game.score).toBe(reference.score);
    expect(s.game.deathCause).toBe(reference.deathCause);
  });

  it("stepOnce plays exactly one decision while paused", async () => {
    const s = new Session();
    s.setPolicy(alwaysForward);
    s.start(5);
    s.setPaused(true);
    run(s, 0.3);
    expect(s.state().decisions).toBe(0);

    s.stepOnce();
    await runUntil(s, () => false, 100);
    expect(s.state()).toMatchObject({ decisions: 1, paused: true });
  });

  it("discards an answer that arrives after a restart", async () => {
    const policy = controlledPolicy();
    const s = new Session();
    s.setPolicy(policy.factory);
    s.start(1);
    s.frame(FRAME);
    s.start(2); // restart while the answer is in flight
    await policy.answer();
    expect(s.state().decisions).toBe(0);
    expect(s.game.tick).toBe(0);
  });

  it("stops in an error phase, with the message, when the policy fails", async () => {
    const failing: PolicyFactory = {
      id: "failing",
      create: () => ({
        kind: "observation",
        id: "failing",
        decide: async () => {
          throw new Error(
            "Local daily budget reached: 26347 of 10000 neurons used today (UTC). Nothing was sent.",
          );
        },
      }),
    };
    const s = new Session();
    s.setPolicy(failing);
    s.start(1);
    s.frame(FRAME);
    await settle();
    expect(s.state().phase).toBe("error");
    expect(s.state().error).toContain("Nothing was sent");
    const before = s.game.tick;
    run(s, 0.5);
    expect(s.game.tick).toBe(before);
  });

  it("tallies tokens, neurons, latency and cache hits from model decisions", async () => {
    let clock = 0;
    const s = new Session({ now: () => (clock += 7) }); // every answer takes 7 ms of wall time
    s.setPolicy(
      constantPolicy("hop_forward", {
        latencyMs: 300,
        inputTokens: 1000,
        neurons: 3.4,
        cached: false,
      }),
    );
    s.start(9);
    await runUntil(s, () => s.state().decisions >= 3 || !s.game.alive);
    const st = s.state();
    expect(st.decisions).toBeGreaterThanOrEqual(2);
    expect(st.avgTokens).toBe(1000);
    expect(st.avgLatencyMs).toBe(7);
    expect(st.neurons).toBeCloseTo(3.4 * st.decisions, 5);

    s.setPolicy(constantPolicy("hop_forward", { cached: true, inputTokens: 900 }));
    s.start(9);
    await runUntil(s, () => s.state().decisions >= 1);
    expect(s.state()).toMatchObject({ cacheHits: s.state().decisions, neurons: 0 });
  });
});

describe("Session: AI in real time", () => {
  it("keeps the world running while a slow answer is in flight", async () => {
    const policy = controlledPolicy();
    const s = new Session();
    s.setTiming("realtime");
    s.setPolicy(policy.factory);
    s.start(4);

    run(s, 0.1); // asks, and the world keeps going
    expect(policy.asked()).toBe(1);
    expect(s.game.tick).toBeGreaterThan(3);

    await policy.answer();
    run(s, 0.05);
    expect(s.state().decisions).toBe(1);
  });
});

describe("Session: speed and best score", () => {
  it("runs faster at higher speed", () => {
    const slow = new Session();
    slow.start(2);
    const fast = new Session();
    fast.setSpeed(4);
    fast.start(2);
    run(slow, 0.5);
    run(fast, 0.5);
    expect(fast.game.tick).toBeGreaterThan(slow.game.tick * 3);
  });

  it("remembers the best score across restarts", () => {
    const s = new Session();
    s.start(7);
    s.humanInput("hop_forward");
    run(s, 0.5);
    s.start(7);
    expect(s.state().score).toBe(0);
    expect(s.state().best).toBe(1);
  });
});
