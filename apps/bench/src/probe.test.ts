import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alwaysForward, type PolicyFactory, platformClock } from "@ccr/agent";
import { ACTIONS, type Action, Game, type Observation, observe } from "@ccr/core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agreementWithWords,
  classify,
  idealMove,
  interleaveStrata,
  type ProbeResult,
  type ProbeState,
  pairedGood,
  rebuild,
  renderProbeReport,
  sampleStates,
  scoreAnswer,
  summarizeProbe,
} from "./probe.ts";
import { PROBE_RESULTS_FILE, readProbeResults, runProbe } from "./probe-run.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "ccr-probe-"));
  dirs.push(dir);
  return dir;
};

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const SMALL = {
  "water-deadly": 3,
  "water-open": 2,
  "road-deadly": 2,
  "road-open": 1,
  tree: 2,
  "tree-stuck": 2,
  "grass-open": 1,
  rail: 1,
  "platform-edge": 3,
  "platform-far": 3,
} as const;

describe("classify", () => {
  it("sorts a decision point by what is ahead and what hopping forward does", () => {
    expect(classify("water", "dies")).toBe("water-deadly");
    expect(classify("water", "ok")).toBe("water-open");
    expect(classify("road", "dies")).toBe("road-deadly");
    expect(classify("road", "ok")).toBe("road-open");
    expect(classify("rail", "dies")).toBe("rail");
    expect(classify("grass", "blocked")).toBe("tree");
    expect(classify("grass", "ok")).toBe("grass-open");
    expect(classify(undefined, "ok")).toBeUndefined();
  });
});

describe("sampleStates", () => {
  let a: ProbeState[];
  beforeAll(async () => {
    a = await sampleStates({ seeds: SEEDS, quotas: SMALL });
  });

  it("is deterministic and keeps to the quotas", async () => {
    const b = await sampleStates({ seeds: SEEDS, quotas: SMALL });
    expect(b).toEqual(a);
    const counts = (id: string) => a.filter((s) => s.stratum === id).length;
    for (const [id, quota] of Object.entries(SMALL)) expect(counts(id)).toBeLessThanOrEqual(quota);
    expect(a.length).toBeGreaterThan(8);
    expect(new Set(a.map((s) => s.id)).size).toBe(a.length);
  });

  it("labels agree with the simulator, and a good move is never one that dies when another is fine", async () => {
    for (const state of a) {
      const { game } = rebuild(state);
      expect(game.alive).toBe(true);
      for (const action of ACTIONS) {
        const probe = game.clone();
        const { outcome } = probe.step(action);
        const expected = outcome === "blocked" ? "blocked" : probe.alive ? "ok" : "dies";
        expect(state.outcomes[action], `${state.id} ${action}`).toBe(expected);
      }
      expect(state.good.length).toBeGreaterThan(0);
      if (state.stratum === "water-deadly" || state.stratum === "road-deadly") {
        expect(state.good).not.toContain("hop_forward");
      }
      if (state.stratum.endsWith("-open")) expect(state.good).toContain("hop_forward");
    }
  });

  it("collects the decision points on a platform, by how close the platform is to the edge of the world", () => {
    const edge = a.filter((s) => s.stratum === "platform-edge");
    const far = a.filter((s) => s.stratum === "platform-far");
    expect(far.length).toBeGreaterThan(0);
    for (const state of [...edge, ...far]) {
      const { game } = rebuild(state);
      const seen = observe(game);
      expect(seen.player.riding, state.id).toBe(true);
      expect(platformClock(seen)?.word === "a_moment", state.id).toBe(
        state.stratum === "platform-edge",
      );
    }
  });

  it("builds the stuck states after real bumps, so the memory tells the story", async () => {
    const stuck = a.filter((s) => s.stratum === "tree-stuck");
    expect(stuck.length).toBeGreaterThan(0);
    for (const state of stuck) {
      const { memory } = rebuild(state);
      expect(memory.recent.at(-1)).toEqual({ action: "hop_forward", outcome: "blocked" });
      expect([1, 3]).toContain(memory.recent.filter((m) => m.outcome === "blocked").length);
    }
  });
});

const state = (overrides: Partial<ProbeState>): ProbeState => ({
  id: "s",
  stratum: "water-deadly",
  seed: 1,
  actions: [],
  outcomes: { hop_forward: "dies", hop_back: "ok", hop_left: "ok", hop_right: "dies", stay: "ok" },
  good: ["hop_left", "stay"],
  ...overrides,
});

describe("interleaveStrata", () => {
  it("puts the first of every stratum first, so any prefix is balanced", () => {
    const make = (stratum: ProbeState["stratum"], n: number) =>
      Array.from({ length: n }, (_, i) => state({ id: `${stratum}-${i + 1}`, stratum }));
    const ordered = interleaveStrata([
      ...make("water-deadly", 3),
      ...make("rail", 1),
      ...make("tree", 2),
    ]);
    expect(ordered.map((s) => s.id)).toEqual([
      "water-deadly-1",
      "tree-1",
      "rail-1",
      "water-deadly-2",
      "tree-2",
      "water-deadly-3",
    ]);
    expect(interleaveStrata([])).toEqual([]);
  });
});

describe("scoring", () => {
  it("scores an answer against the labels of its state", () => {
    const answer = (action: Action, probabilities?: ProbeResult["probabilities"]): ProbeResult => ({
      policy: "p",
      state: "s",
      action,
      ...(probabilities ? { probabilities } : {}),
    });
    expect(scoreAnswer(state({}), answer("hop_forward"))).toMatchObject({
      fatal: true,
      good: false,
      forward: true,
    });
    expect(scoreAnswer(state({}), answer("stay"))).toMatchObject({
      fatal: false,
      good: true,
      forward: false,
    });
    const mass = scoreAnswer(
      state({}),
      answer("stay", { hop_forward: 0.5, hop_right: 0.25, stay: 0.25 }),
    );
    expect(mass.deathMass).toBeCloseTo(0.75, 10);
  });

  it("counts a bump as a bump, not as a death", () => {
    const stuck = state({ outcomes: { ...state({}).outcomes, hop_forward: "blocked" } });
    expect(scoreAnswer(stuck, { policy: "p", state: "s", action: "hop_forward" })).toMatchObject({
      bumped: true,
      fatal: false,
    });
  });
});

describe("the report", () => {
  const states = [
    state({ id: "w1" }),
    state({ id: "w2" }),
    state({
      id: "o1",
      stratum: "water-open",
      outcomes: { ...state({}).outcomes, hop_forward: "ok" },
      good: ["hop_forward"],
    }),
  ];
  const answers = (policy: string, actions: Action[]): ProbeResult[] =>
    states.map((s, i) => ({ policy, state: s.id, action: actions[i] as Action }));
  const results = [
    ...answers("control", ["hop_forward", "hop_forward", "hop_forward"]),
    ...answers("better", ["stay", "hop_left", "hop_forward"]),
  ];

  it("summarises each policy by stratum, with the water strata together", () => {
    const rows = summarizeProbe(states, results);
    const control = rows.find((r) => r.policy === "control" && r.stratum === "water-deadly");
    expect(control).toMatchObject({ n: 2, fatal: 1, good: 0 });
    const water = rows.find((r) => r.policy === "better" && r.stratum === "water");
    expect(water).toMatchObject({ n: 3, fatal: 0, good: 1 });
  });

  it("pairs the policies on the same states", () => {
    const { n, diff } = pairedGood(states, results, "better", "control", [
      "water-deadly",
      "water-open",
    ]);
    expect(n).toBe(3);
    expect(diff.estimate).toBeCloseTo(2 / 3, 10); // 3 good of 3 against 1 good of 3
  });

  it("renders a table and the paired section against the control", () => {
    const text = renderProbeReport("T", states, results, "control");
    expect(text).toContain("| `control` | water-deadly | 2 | 100% | 0% | 0% |");
    expect(text).toContain("paired against `control`");
    expect(text).toMatch(/\| `better` \| water \| 3 \| \+?67 pts/);
  });
});

describe("runProbe", () => {
  const states = [state({ id: "a", seed: 1 }), state({ id: "b", seed: 2 })];

  /** A policy that records everything a model would be shown. */
  function spy(seen: string[]): PolicyFactory {
    return {
      id: "spy",
      create: () => ({
        kind: "observation",
        id: "spy",
        decide: async (obs: Observation, memory) => {
          seen.push(JSON.stringify({ obs, memory }));
          return { action: "stay", probabilities: { stay: 1 } };
        },
      }),
    };
  }

  it("asks every policy about every state once, writes the answers, and resumes", async () => {
    const dir = tempDir();
    const seen: string[] = [];
    const options = {
      runDir: dir,
      states,
      policies: [spy(seen), alwaysForward],
      concurrency: 2,
      maxCalls: 100,
    };
    expect(await runProbe(options)).toMatchObject({
      asked: 4,
      skipped: 0,
      failed: 0,
      stoppedBecause: "done",
    });
    expect(readProbeResults(dir)).toHaveLength(4);
    expect(PROBE_RESULTS_FILE).toBe("results.ndjson");

    const again = await runProbe(options);
    expect(again).toMatchObject({ asked: 0, skipped: 4 });
    expect(readProbeResults(dir)).toHaveLength(4);
  });

  it("shows a model the observation and the memory, never the labels", async () => {
    const seen: string[] = [];
    await runProbe({
      runDir: tempDir(),
      states,
      policies: [spy(seen)],
      concurrency: 1,
      maxCalls: 100,
    });
    expect(seen).toHaveLength(2);
    for (const shown of seen) {
      expect(shown).not.toMatch(/outcomes|good|dies|fatal|stratum/i);
      expect(JSON.parse(shown).memory).toEqual({
        recent: [],
        score: 0,
        sinceProgress: 0,
        behindFrontier: 0,
      });
    }
    expect(Object.keys(JSON.parse(seen[0] as string).obs).sort()).toEqual(["player", "rows"]);
  });

  it("asks state by state, so stopping early leaves every policy with the same states", async () => {
    const order: string[] = [];
    const named = (id: string): PolicyFactory => ({
      id,
      create: () => ({
        kind: "observation",
        id,
        decide: async () => {
          order.push(id);
          return { action: "stay" };
        },
      }),
    });
    await runProbe({
      runDir: tempDir(),
      states,
      policies: [named("one"), named("two")],
      concurrency: 1,
      maxCalls: 100,
    });
    expect(order).toEqual(["one", "two", "one", "two"]);
  });

  it("rebuilds the world the state describes", () => {
    const { game } = rebuild({ seed: 5, actions: ["hop_forward", "hop_forward"] });
    const same = new Game({ seed: 5 });
    same.step("hop_forward");
    same.step("hop_forward");
    expect(game.tick).toBe(same.tick);
    expect(game.score).toBe(same.score);
  });
});

describe("agreement with the ideal follower of the words", () => {
  let states: ProbeState[];
  beforeAll(async () => {
    states = await sampleStates({ seeds: SEEDS, quotas: SMALL });
  });

  const words = "clef:clef-flash:moves:choice:ordered";

  it("only exists for the conditions that read the words, and not for the manoeuvre strategy", () => {
    const state = states[0] as ProbeState;
    expect(idealMove(words, state)).toBeDefined();
    expect(idealMove("clef:clef-flash:lanes:choice:rules", state)).toBeDefined();
    expect(idealMove("clef:clef-flash:json-fx:choice:full", state)).toBeUndefined();
    expect(idealMove("clef:clef-flash:moves:maneuver:ordered", state)).toBeUndefined();
    expect(idealMove("lookahead", state)).toBeUndefined();
  });

  it("counts the answers that match the ideal one, per stratum", () => {
    const results: ProbeResult[] = states.map((state, i) => {
      const ideal = idealMove(words, state) as Action;
      // Every other answer is wrong on purpose.
      const action = i % 2 === 0 ? ideal : ideal === "hop_forward" ? "hop_back" : "hop_forward";
      return { policy: words, state: state.id, action };
    });
    const found = agreementWithWords(states, results, words);
    expect(found?.n).toBe(states.length);
    expect(found?.agree).toBe(Math.ceil(states.length / 2));
    const perStratum = [...(found?.byStratum.values() ?? [])].reduce((sum, [n]) => sum + n, 0);
    expect(perStratum).toBe(states.length);
  });

  it("is left out of the report for a policy that does not read the words, and shown for one that does", () => {
    const other = "clef:clef-flash:json-fx:choice:full";
    const results: ProbeResult[] = states.flatMap((state) => [
      { policy: words, state: state.id, action: "hop_forward" as Action },
      { policy: other, state: state.id, action: "hop_forward" as Action },
    ]);
    expect(agreementWithWords(states, results, other)).toBeUndefined();
    const report = renderProbeReport("t", states, results, other);
    expect(report).toContain("agreement with the ideal follower of the words");
    expect(report).toContain(words);
  });
});
