import { clefPolicy, DEFAULT_CLEF, routeQuestions } from "@ccr/agent";
import { describe, expect, it } from "vitest";
import { Session } from "../session.ts";
import {
  answeredSession,
  choice,
  clientAnswering,
  FRAME,
  readingSession,
  routeAnswers,
  settle,
} from "./test-support.ts";
import { questionsOf } from "./view.ts";

describe("questionsOf: what the model was asked", () => {
  it("lists the three lookups in order, with their options, and no answer while it reads", () => {
    const s = readingSession(routeAnswers("no_stand", "still", "detour_right", 0.1));
    const input = s.state().asking?.input;
    if (!input) throw new Error("expected a question to be out");
    const questions = questionsOf(input, null);

    expect(questions.map((q) => q.id)).toEqual(["cell", "moving", "around"]);
    const cell = questions[0];
    expect(cell?.title).toBe("Can it stand there?");
    expect(cell?.options.map((o) => o.id)).toEqual(["stand", "no_stand"]);
    expect(cell?.options.map((o) => o.short)).toEqual(["Yes", "No"]);
    expect(cell?.options.every((o) => o.p === null && !o.chosen)).toBe(true);
    expect(cell?.chosen).toBeNull();
    expect(cell?.options[0]?.rule).toContain("cross_ahead.lands_on");
  });

  it("gives each option the probability the model gave it, and marks the pick", async () => {
    const s = await answeredSession(routeAnswers("no_stand", "still", "detour_right", 0.1));
    const log = s.state().lastModel;
    const input = log?.decision.sent;
    if (!log || !input) throw new Error("expected the model to have answered");
    const [cell, moving, around] = questionsOf(input, log);

    expect(cell?.chosen).toBe("no_stand");
    expect(cell?.options.map((o) => [o.id, o.p, o.chosen])).toEqual([
      ["stand", 0.1, false],
      ["no_stand", 0.9, true],
    ]);
    expect(moving?.skipped).toBeNull();
    expect(around?.skipped).toBeNull();
    expect(around?.chosen).toBe("detour_right");
  });

  it("says which questions the routing never looked at", async () => {
    const open = await answeredSession(routeAnswers("stand", "still", "detour_left", 0.9), 1);
    const log = open.state().lastModel;
    const input = log?.decision.sent;
    if (!log || !input) throw new Error("expected the model to have answered");
    const byId = Object.fromEntries(questionsOf(input, log).map((q) => [q.id, q.skipped]));
    expect(byId.cell).toBeNull();
    expect(byId.moving).toMatch(/can stand there/);
    expect(byId.around).toMatch(/isn't closed/);
  });

  it("adds the platform question after the three, with its own words, when the chicken stood on one", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "detour_left", 0.9), 1);
    const log = s.state().lastModel;
    const input = log?.decision.sent;
    if (!log || !input) throw new Error("expected the model to have answered");
    const riding = {
      ...log,
      decision: {
        ...log.decision,
        sent: { ...input, questions: routeQuestions(true) },
        answers: {
          ...log.decision.answers,
          ride: { choice: "staying", probabilities: { leaving: 0.1, staying: 0.9 } },
        },
        extra: { ...log.decision.extra, ride: "staying" },
      },
    };
    const questions = questionsOf(riding.decision.sent, riding);
    expect(questions.map((q) => q.id)).toEqual(["cell", "moving", "around", "ride"]);
    const ride = questions[3];
    expect(ride?.title).toBe("Is the edge a moment away?");
    expect(ride?.options.map((o) => [o.short, o.p, o.chosen])).toEqual([
      ["Leave", 0.1, false],
      ["Stay", 0.9, true],
    ]);
    expect(ride?.skipped).toBeNull();
  });

  it("calls the other three not needed once the platform is leaving the world", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "detour_left", 0.9), 1);
    const log = s.state().lastModel;
    const input = log?.decision.sent;
    if (!log || !input) throw new Error("expected the model to have answered");
    const leaving = {
      ...log,
      decision: {
        ...log.decision,
        sent: { ...input, questions: routeQuestions(true) },
        answers: {
          ...log.decision.answers,
          ride: { choice: "leaving", probabilities: { leaving: 0.8, staying: 0.2 } },
        },
        extra: { ...log.decision.extra, ride: "leaving", maneuver: "leave_platform" },
      },
    };
    const byId = Object.fromEntries(
      questionsOf(leaving.decision.sent, leaving).map((q) => [q.id, q.skipped]),
    );
    expect(byId.cell).toMatch(/platform is leaving/);
    expect(byId.moving).toMatch(/platform is leaving/);
    expect(byId.around).toMatch(/platform is leaving/);
    expect(byId.ride).toBeNull();
  });

  it("shows a plain choice over the five moves in the panel's order, with arrows", async () => {
    const s = new Session();
    const client = clientAnswering({
      move: choice("hop_left", {
        hop_back: 0,
        hop_forward: 0.1,
        hop_left: 0.6,
        hop_right: 0.2,
        stay: 0.1,
      }),
    });
    s.setPolicy(
      clefPolicy(client, { ...DEFAULT_CLEF, encoder: "json", strategy: "choice", manual: "full" }),
    );
    s.start(1);
    s.frame(FRAME);
    await settle();
    const log = s.state().lastModel;
    const input = log?.decision.sent;
    if (!log || !input) throw new Error("expected the model to have answered");
    const [move] = questionsOf(input, log);
    expect(move?.id).toBe("move");
    expect(move?.options.map((o) => o.id)).toEqual([
      "hop_forward",
      "hop_left",
      "hop_right",
      "stay",
      "hop_back",
    ]);
    expect(move?.options.find((o) => o.id === "hop_left")).toMatchObject({
      glyph: "←",
      label: "Left",
      p: 0.6,
      chosen: true,
    });
  });

  it("has nothing to show for yes/no questions, which have no options", () => {
    const s = new Session();
    const noul = (n: number) => ({ type: "noul", noul: n });
    const client = clientAnswering({
      dies_if_hop_forward: noul(0.1),
      dies_if_hop_back: noul(0.1),
      dies_if_hop_left: noul(0.1),
      dies_if_hop_right: noul(0.1),
      dies_if_stay: noul(0.1),
    });
    s.setPolicy(
      clefPolicy(client, { ...DEFAULT_CLEF, encoder: "json", strategy: "critic", manual: "full" }),
    );
    s.start(1);
    s.frame(FRAME);
    const input = s.state().asking?.input;
    if (!input) throw new Error("expected a question to be out");
    expect(questionsOf(input, null)).toEqual([]);
  });
});
