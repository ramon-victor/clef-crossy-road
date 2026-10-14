import { alwaysForward, type Decision, type PolicyFactory } from "@ccr/agent";
import { constantPolicy } from "@ccr/agent/testing";
import { Game } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { Session } from "./session.ts";

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
  it("runs the world and applies key input immediately", () => {
    const s = new Session();
    s.start(7);
    s.humanInput("hop_forward");
    run(s, 0.5);
    expect(s.game.score).toBe(1);
    expect(s.state().human).toBe(true);
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
