import { describe, expect, it } from "vitest";
import type { SessionState } from "../session.ts";
import { buildFeed, TURNS_SHOWN } from "./feed.ts";
import { answeredSession, readingSession, routeAnswers } from "./test-support.ts";

describe("buildFeed: the conversation", () => {
  it("opens with the game's side and the model's question while it reads", () => {
    const s = readingSession(routeAnswers("no_stand", "still", "detour_right", 0.1));
    const [turn, ...rest] = buildFeed(s.state());

    expect(rest).toEqual([]);
    expect(turn?.reading).toBe(true);
    expect(turn?.old).toBe(false);
    expect(turn?.since).toEqual(expect.any(Number));
    expect(turn?.move).toBeNull();
    expect(turn?.scene?.tile).toEqual(expect.any(String));
    expect(turn?.scene?.gaps).toHaveLength(2);
    expect(turn?.questions.map((q) => q.id)).toEqual(["cell", "moving", "around", "here"]);
    expect(turn?.questions.every((q) => q.options.every((o) => o.p === null))).toBe(true);
    expect(turn?.facts).toMatchObject({ model: "clef-flash", latencyMs: undefined, cached: false });
  });

  it("shows what it answered to each question, and what that comes to", async () => {
    const s = await answeredSession(routeAnswers("no_stand", "still", "detour_right", 0.1));
    const [turn] = buildFeed(s.state());

    expect(turn?.reading).toBe(false);
    expect(turn?.since).toBeNull();
    expect(turn?.move).toEqual({ glyph: "→", label: "Detour right" });
    expect(turn?.summary).toEqual(["✗", "▪", "→", "✓"]);
    const cell = turn?.questions[0];
    expect(cell?.options.map((o) => [o.short, o.p, o.chosen])).toEqual([
      ["Yes", 0.1, false],
      ["No", 0.9, true],
    ]);
    expect(turn?.facts).toMatchObject({ inputTokens: 1500, cached: false });
  });

  it("files the controller's steps under the answer they follow", async () => {
    const s = await answeredSession(routeAnswers("no_stand", "still", "detour_right", 0.1), 4, 2);
    const [turn] = buildFeed(s.state());
    expect(turn?.steps.length).toBeGreaterThanOrEqual(2);
    expect(turn?.steps[0]?.note).toContain("walking the detour");
    expect(turn?.steps.every((step) => step.glyph !== "")).toBe(true);
  });

  it("puts the next question below the last answer, and shrinks the answer to a line", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "detour_left", 0.9), 1);
    // The open grass ahead means the model is asked again right after the hop.
    for (let i = 0; i < 400 && !s.state().asking; i++) {
      s.frame(1 / 60);
      await Promise.resolve();
    }
    const turns = buildFeed(s.state());
    if (s.state().asking) {
      expect(turns.at(-1)?.reading).toBe(true);
      expect(turns.slice(0, -1).every((t) => t.old)).toBe(true);
    }
    expect(turns.at(-1)?.old).toBe(false);
  });

  it("keeps only the latest few rounds", () => {
    const s = readingSession(routeAnswers("stand", "still", "wait_here", 0.9), 1);
    expect(buildFeed(s.state()).length).toBeLessThanOrEqual(TURNS_SHOWN);
  });

  it("is empty before anything was asked", () => {
    const s = readingSession(routeAnswers("stand", "still", "wait_here"));
    s.start(4);
    expect(buildFeed(s.state())).toEqual([]);
  });
});

describe("buildFeed: the waits, the way that opens when things pass, and one round per decision", () => {
  const waitStep = (log: { index: number }, n: number) => ({
    ...log,
    index: log.index + n,
    action: "stay" as const,
    decision: {
      action: "stay" as const,
      source: "executor" as const,
      note: `cross_ahead: waiting for the cell (vehicle) to clear, ${n}/15`,
      extra: { controller: { kind: "wait", n, of: 15, cell: "vehicle" } },
    },
  });

  it("folds a run of waits for a gap into one step with the count", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "detour_left", 0.9), 1);
    const real = s.state();
    const first = real.turns[0];
    if (!first) throw new Error("expected a round");
    const hop = {
      ...first.model,
      index: first.model.index + 4,
      action: "hop_forward" as const,
      decision: {
        action: "hop_forward" as const,
        source: "executor" as const,
        extra: { controller: { kind: "hop" } },
      },
    };
    const state = {
      ...real,
      turns: [
        {
          model: first.model,
          steps: [
            waitStep(first.model, 1),
            waitStep(first.model, 2),
            waitStep(first.model, 3),
            hop,
          ],
        },
      ],
    };
    const [turn] = buildFeed(state as unknown as SessionState);
    expect(turn?.steps.map((step) => [step.glyph, step.count])).toEqual([
      ["•", 3],
      ["↑", 1],
    ]);
    expect(turn?.steps[0]?.note).toContain("3/15"); // the latest of the run
  });

  it("calls a crossing that waited for things to pass 'when clear', and one made at once plain", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "detour_left", 0.9), 1);
    const real = s.state();
    const first = real.turns[0];
    if (!first) throw new Error("expected a round");
    expect(buildFeed(real)[0]?.move?.label).toBe("Go straight");
    const waited = (controller: unknown) => ({
      ...first,
      model: {
        ...first.model,
        decision: {
          ...first.model.decision,
          extra: { ...first.model.decision.extra, ahead: "passing", controller },
        },
      },
    });
    // The answers allowed a wait, but the controller hopped at once: nothing to wait for.
    expect(buildFeed({ ...real, turns: [waited({ kind: "hop" })] })[0]?.move?.label).toBe(
      "Go straight",
    );
    expect(
      buildFeed({
        ...real,
        turns: [waited({ kind: "wait", n: 1, of: 15, cell: "water", why: "gap" })],
      })[0]?.move?.label,
    ).toBe("Go straight · when clear");
  });

  it("says what the controller did with the answer when it was not simply the crossing", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "detour_left", 0.9), 1);
    const real = s.state();
    const first = real.turns[0];
    if (!first) throw new Error("expected a round");
    expect(buildFeed(real)[0]?.said).toBeNull();
    const refused = {
      ...first,
      model: {
        ...first.model,
        decision: {
          ...first.model.decision,
          notice: {
            kind: "refused" as const,
            maneuver: "cross_ahead" as const,
            reason: { kind: "drift" as const },
          },
          note: "model chose cross_ahead; cross_ahead: refused, a platform is carrying it past the edge of the world; stepping off a cell it cannot stay on: back (1 to go)",
          extra: { ...first.model.decision.extra, controller: { kind: "hold", why: "edge" } },
        },
      },
    };
    expect(buildFeed({ ...real, turns: [refused] })[0]?.said).toBe(
      "cross ahead could not start. A platform is carrying the chicken beyond the edge of the map.",
    );
  });

  it("does not list an answered round beside the question that is out for the same decision", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "detour_left", 0.9), 1);
    const real = s.state();
    const first = real.turns[0];
    if (!first) throw new Error("expected a round");
    const asking = {
      input: first.model.decision.sent as NonNullable<typeof first.model.decision.sent>,
      since: 0,
    };
    const rounds = buildFeed({ ...real, asking, decisions: first.model.index });
    expect(rounds.map((round) => round.index)).toEqual([first.model.index]);
    expect(rounds[0]?.reading).toBe(true);
  });
});
