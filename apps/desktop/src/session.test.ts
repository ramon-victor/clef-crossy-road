import { alwaysForward, type Decision, type PolicyFactory } from "@ccr/agent";
import { type Action, Game } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { Session } from "./session.ts";

const FRAME = 1 / 60;

function run(session: Session, seconds: number): void {
  for (let t = 0; t < seconds; t += FRAME) session.frame(FRAME);
}

/** A model-like policy whose answer arrives after a controllable delay. */
function slowPolicy(delayMs: number, action: Action = "hop_forward") {
  const calls: number[] = [];
  const factory: PolicyFactory = {
    id: "slow",
    create: () => ({
      kind: "observation",
      id: "slow",
      decide: async (): Promise<Decision> => {
        calls.push(Date.now());
        await new Promise((r) => setTimeout(r, delayMs));
        return { action, latencyMs: delayMs, inputTokens: 1000, neurons: 3.4, cached: false };
      },
    }),
  };
  return { factory, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

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
  it("freezes the world while the policy thinks, then plays the hop out", async () => {
    const { factory } = slowPolicy(40);
    const s = new Session();
    s.setPolicy(factory);
    s.start(3);

    s.frame(FRAME); // asks the policy
    expect(s.state().phase).toBe("thinking");
    run(s, 0.02);
    expect(s.game.tick).toBe(0); // the world did not move while waiting

    await new Promise((r) => setTimeout(r, 60));
    expect(s.state().phase).toBe("hopping");
    run(s, 0.5);
    expect(s.game.tick).toBeGreaterThanOrEqual(12);
    expect(s.state().decisions).toBeGreaterThanOrEqual(1);
    expect(s.state().last?.action).toBe("hop_forward");
  });

  it("matches the benchmark: one decision per 12-tick hop, same result as Game.step", async () => {
    const s = new Session();
    s.setPolicy(alwaysForward);
    s.start(11);
    for (let i = 0; i < 4000 && s.game.alive; i++) {
      s.frame(FRAME);
      await tick();
    }
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
    for (let i = 0; i < 100; i++) {
      s.frame(FRAME);
      await tick();
    }
    expect(s.state().decisions).toBe(1);
    expect(s.state().paused).toBe(true);
  });

  it("discards an answer that arrives after a restart", async () => {
    const { factory } = slowPolicy(30);
    const s = new Session();
    s.setPolicy(factory);
    s.start(1);
    s.frame(FRAME);
    s.start(2); // restart while the answer is in flight
    await new Promise((r) => setTimeout(r, 60));
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
    await tick();
    expect(s.state().phase).toBe("error");
    expect(s.state().error).toContain("Nothing was sent");
    const before = s.game.tick;
    run(s, 0.5);
    expect(s.game.tick).toBe(before);
  });

  it("tallies tokens, neurons and latency from model decisions", async () => {
    const { factory } = slowPolicy(5);
    const s = new Session();
    s.setPolicy(factory);
    s.start(9);
    for (let i = 0; i < 600 && s.state().decisions < 3 && s.game.alive; i++) {
      s.frame(FRAME);
      await new Promise((r) => setTimeout(r, 1));
    }
    const st = s.state();
    expect(st.decisions).toBeGreaterThanOrEqual(3);
    expect(st.avgTokens).toBe(1000);
    expect(st.neurons).toBeCloseTo(3.4 * st.decisions, 5);
    expect(st.avgLatencyMs).not.toBeNull();
  });
});

describe("Session: AI in real time", () => {
  it("keeps the world running while a slow answer is in flight", async () => {
    const { factory } = slowPolicy(120);
    const s = new Session();
    s.setTiming("realtime");
    s.setPolicy(factory);
    s.start(4);

    run(s, 0.1); // asks, and the world keeps going
    expect(s.game.tick).toBeGreaterThan(3);
    await new Promise((r) => setTimeout(r, 150));
    run(s, 0.05);
    expect(s.state().decisions).toBeGreaterThanOrEqual(1);
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
