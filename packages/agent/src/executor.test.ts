import { ClefClient, type ClefRequest, MemoryCache, type Transport } from "@ccr/clef";
import { ACTIONS, Game, observe } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { alwaysForward } from "./baselines.ts";
import {
  type ClefPolicyConfig,
  clefPolicy,
  clefPolicyId,
  helpLabel,
  parseClefPolicyId,
} from "./clef-policy.ts";
import { decisionCost } from "./cost.ts";
import {
  alwaysCross,
  Executor,
  execCross,
  execRules,
  MANEUVER_ACTION,
  MANEUVER_IDS,
  MAX_WAIT_STEPS,
  maneuverByRules,
  stepPlan,
} from "./executor.ts";
import { type LanesState, lanesState } from "./lanes.ts";
import { criteriaFor, MANUAL_IDS, MANUALS, RULES_CRITERIA } from "./prompts.ts";
import { playEpisode } from "./runner.ts";

/** A state where straight ahead is open grass, to be bent into the case each test needs. */
const base = lanesState(observe(new Game({ seed: 1 })));
const withForward = (lands_on: LanesState["forward"]["lands_on"], rest = {}): LanesState => ({
  ...base,
  forward: { ...base.forward, lands_on, ...rest },
});

describe("stepPlan: one step of a manoeuvre, reading the world as it is now", () => {
  it("hops as soon as the cell can be stood on, and says how it went", () => {
    const step = stepPlan({ maneuver: "cross_ahead", waited: 3 }, withForward("log"));
    expect(step).toMatchObject({
      kind: "act",
      action: "hop_forward",
      plan: null,
      result: "cross_ahead: hopped after waiting 3 step(s)",
    });
  });

  it("each manoeuvre looks at its own cell", () => {
    const state: LanesState = {
      ...withForward("water"),
      sideways: { left_lands_on: "empty", right_lands_on: "water" },
      backward: { ...base.backward, lands_on: "lily_pad" },
    };
    expect(stepPlan({ maneuver: "sidestep_left", waited: 0 }, state)).toMatchObject({
      action: "hop_left",
    });
    expect(stepPlan({ maneuver: "sidestep_right", waited: 0 }, state)).toMatchObject({
      action: "stay",
      plan: { maneuver: "sidestep_right", waited: 1 },
    });
    expect(stepPlan({ maneuver: "back_off", waited: 0 }, state)).toMatchObject({
      action: "hop_back",
    });
  });

  it("waits for a cell that will clear, a step at a time", () => {
    const step = stepPlan({ maneuver: "cross_ahead", waited: 4 }, withForward("vehicle"));
    expect(step).toMatchObject({ kind: "act", action: "stay", plan: { waited: 5 } });
  });

  it("gives the decision back instead of waiting for what never changes", () => {
    expect(stepPlan({ maneuver: "cross_ahead", waited: 0 }, withForward("tree"))).toEqual({
      kind: "handback",
      why: "tree does not go away",
      reason: { kind: "permanent", cell: "tree" },
    });
  });

  it("gives it back when waiting where it stands is no longer possible", () => {
    const threatened: LanesState = {
      ...withForward("vehicle"),
      chicken: { ...base.chicken, stays_on: "vehicle" },
    };
    expect(stepPlan({ maneuver: "cross_ahead", waited: 0 }, threatened).kind).toBe("handback");
    const swept: LanesState = {
      ...withForward("water"),
      chicken: {
        ...base.chicken,
        carried_towards: "left",
        place_in_world: "at_left_edge",
        stays_on: "log",
      },
    };
    expect(stepPlan({ maneuver: "cross_ahead", waited: 0 }, swept)).toMatchObject({
      kind: "handback",
      why: "a platform is carrying it to the edge",
    });
  });

  it("gives it back after three seconds of game time", () => {
    const step = stepPlan(
      { maneuver: "cross_ahead", waited: MAX_WAIT_STEPS },
      withForward("water"),
    );
    expect(step.kind).toBe("handback");
    expect(MAX_WAIT_STEPS * 0.2).toBeCloseTo(3);
  });

  it("wait_here is one step still", () => {
    expect(stepPlan({ maneuver: "wait_here", waited: 0 }, withForward("tree"))).toMatchObject({
      action: "stay",
      plan: null,
    });
  });
});

describe("Executor: the manoeuvre in progress between decisions", () => {
  it("has nothing to do until a manoeuvre starts, then carries it out and goes idle", () => {
    const executor = new Executor();
    expect(executor.next(withForward("vehicle"))).toBeNull();
    const first = executor.start("cross_ahead", withForward("vehicle"));
    expect(first.action).toBe("stay");
    expect(executor.next(withForward("vehicle"))?.action).toBe("stay");
    expect(executor.next(withForward("empty"))?.action).toBe("hop_forward");
    expect(executor.next(withForward("empty"))).toBeNull();
    expect(executor.lastResult).toBe("cross_ahead: hopped after waiting 2 step(s)");
  });

  it("refuses a manoeuvre that cannot begin: the chicken waits a step and the model hears why", () => {
    const executor = new Executor();
    const act = executor.start("cross_ahead", withForward("tree"));
    expect(act.action).toBe("stay");
    expect(act.plan).toBeNull();
    expect(executor.lastResult).toBe("cross_ahead: refused, tree does not go away");
    expect(executor.next(withForward("tree"))).toBeNull();
  });

  it("remembers why it gave a manoeuvre back", () => {
    const executor = new Executor();
    executor.start("cross_ahead", withForward("water"));
    for (let i = 0; i < MAX_WAIT_STEPS; i++) executor.next(withForward("water"));
    expect(executor.next(withForward("water"))).toBeNull();
    expect(executor.lastResult).toMatch(
      /^cross_ahead: given back, the cell \(water\) did not clear/,
    );
  });
});

describe("scripted players with the executor", () => {
  it("are free: no step is a model call", async () => {
    const result = await playEpisode(execRules, 3);
    expect(result.records.length).toBeGreaterThan(5);
    for (const record of result.records) {
      expect(record.source).toBe("executor");
      expect(record.neurons).toBeUndefined();
    }
  });

  it("the executor alone (always cross) is a floor: it waits in front of a tree for ever", async () => {
    const result = await playEpisode(execCross, 1, { stallLimit: 20 });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(execCross.id).toBe("exec-cross");
    expect(alwaysCross(base)).toBe("cross_ahead");
  });

  it("the ideal follower of the manoeuvre rules plays far better than always forward", async () => {
    let rules = 0;
    let forward = 0;
    const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
    for (const seed of seeds) {
      rules += (await playEpisode(execRules, seed)).score;
      forward += (await playEpisode(alwaysForward, seed)).score;
    }
    expect(rules / seeds.length).toBeGreaterThan(2 * (forward / seeds.length));
  });

  it("picks manoeuvres the way the manual describes them", () => {
    expect(maneuverByRules(withForward("log"))).toBe("cross_ahead");
    expect(maneuverByRules(withForward("vehicle", { things_move: "left" }))).toBe("cross_ahead");
    // Water that nothing crosses will not open: go round, to the side whose way ahead is open.
    const still: LanesState = {
      ...withForward("water", { things_move: "no", lands_on_after_stepping_right: "lily_pad" }),
      sideways: { left_lands_on: "tree", right_lands_on: "empty" },
    };
    expect(maneuverByRules(still)).toBe("sidestep_right");
    // A tree ahead and trees to both sides: nowhere to go, and where it stands cannot hurt it.
    const boxedIn: LanesState = {
      ...withForward("tree", { lands_on_after_stepping_left: "empty" }),
      sideways: { left_lands_on: "tree", right_lands_on: "tree" },
    };
    expect(maneuverByRules(boxedIn)).toBe("wait_here");
    // Open to the left: go round the tree.
    expect(maneuverByRules(withForward("tree", { lands_on_after_stepping_left: "empty" }))).toBe(
      "sidestep_left",
    );
  });
});

describe("the maneuver strategy, through the Clef policy", () => {
  const config: ClefPolicyConfig = {
    model: "clef-flash",
    encoder: "lanes",
    strategy: "maneuver",
    manual: "rules",
  };

  function clientChoosing(choice: string) {
    const requests: ClefRequest[] = [];
    const transport: Transport = {
      async post(req) {
        requests.push(req.body as ClefRequest);
        const probabilities = Object.fromEntries(
          MANEUVER_IDS.map((m) => [m, m === choice ? 0.6 : 0.1]),
        );
        return {
          status: 200,
          json: {
            result: {
              answers: { move: { type: "choice", choice, probabilities, confidence: 0.4 } },
              usage: { input_tokens: 800, output_tokens: 0 },
            },
            success: true,
          },
        };
      },
    };
    return {
      client: new ClefClient({ transport, cache: new MemoryCache(), sleep: async () => {} }),
      requests,
    };
  }

  it("asks the model once, then takes the steps itself without asking again", async () => {
    const { client, requests } = clientChoosing("cross_ahead");
    const game = new Game({ seed: 1 });
    // Seed 1 starts with grass ahead; make the model's manoeuvre wait first by hopping to a row it must wait for.
    const policy = clefPolicy(client, config).create(1);
    if (policy.kind !== "observation") throw new Error("expected an observation policy");

    const first = await policy.decide(observe(game));
    expect(requests).toHaveLength(1);
    expect(first.source).toBe("model");
    expect(first.action).toBe("hop_forward");
    expect(first.extra).toEqual({ maneuver: "cross_ahead" });
    expect(first.probabilities?.hop_forward).toBeCloseTo(0.6);
    expect(first.sent?.questions.move?.type).toBe("choice");
    expect(first.note).toContain("model chose cross_ahead");
  });

  it("keeps the answer's probabilities on the move each manoeuvre is made of", async () => {
    const { client } = clientChoosing("wait_here");
    const policy = clefPolicy(client, config).create(1);
    if (policy.kind !== "observation") throw new Error("expected an observation policy");
    const decision = await policy.decide(observe(new Game({ seed: 1 })));
    expect(decision.action).toBe("stay");
    expect(Object.keys(decision.probabilities ?? {}).sort()).toEqual([...ACTIONS].sort());
  });

  it("a game spends model calls only when the manoeuvre is over", async () => {
    const { client, requests } = clientChoosing("cross_ahead");
    const result = await playEpisode(clefPolicy(client, config), 2, { maxDecisions: 40 });
    const asked = result.records.filter((r) => r.source !== "executor").length;
    expect(asked).toBe(requests.length);
    expect(requests.length).toBeLessThan(result.records.length + 1);
    expect(result.records.length).toBeGreaterThan(0);
  });

  it("tells the model how its last manoeuvre went", async () => {
    const { client, requests } = clientChoosing("cross_ahead");
    // On seed 4 the first row ahead is water with nothing to land on: the manoeuvre waits, then gives up.
    const game = new Game({ seed: 4 });
    game.step("hop_forward");
    const policy = clefPolicy(client, config).create(4);
    if (policy.kind !== "observation") throw new Error("expected an observation policy");
    for (let i = 0; i < MAX_WAIT_STEPS + 3; i++) {
      await policy.decide(observe(game));
      game.step("stay");
    }
    expect(requests.length).toBeGreaterThanOrEqual(2);
    const [firstRequest, secondRequest] = requests.map((r) => r.state as LanesState);
    expect(secondRequest?.memory.last_maneuver).toMatch(/^cross_ahead: given back/);
    expect(JSON.stringify(firstRequest?.memory)).not.toContain("last_maneuver");
  });

  it("each episode gets its own executor, so no manoeuvre leaks from one game into the next", async () => {
    const { client } = clientChoosing("cross_ahead");
    const factory = clefPolicy(client, config);
    expect(factory.create(1)).not.toBe(factory.create(1));
  });
});

describe("ids, labels and costs of the new conditions", () => {
  it("the lanes view, the rules manual and the maneuver strategy parse and print back", () => {
    for (const id of [
      "clef:clef-flash:lanes:choice:rules",
      "clef:clef-flash:lanes:choice:full",
      "clef:clef-flash:lanes:maneuver:rules",
    ]) {
      expect(clefPolicyId(parseClefPolicyId(id))).toBe(id);
    }
  });

  it("refuses combinations that mean nothing", () => {
    expect(() => parseClefPolicyId("clef:clef-flash:json:choice:rules")).toThrow(/lanes view/);
    expect(() => parseClefPolicyId("clef:clef-flash:lanes:maneuver:full")).toThrow(/rules manual/);
    expect(() => parseClefPolicyId("clef:clef-flash:json:maneuver:rules")).toThrow();
    expect(() => parseClefPolicyId("clef:clef-flash:lanes:critic:full")).toThrow(/critic/);
  });

  it("labels the help a condition gets, so a result is never read without it", () => {
    const label = (id: string) => helpLabel(parseClefPolicyId(id));
    expect(label("clef:clef-flash:json:choice:full")).toBe("now");
    expect(label("clef:clef-flash:json-fx:choice:full")).toBe("forecast");
    expect(label("clef:clef-flash:lanes:choice:full")).toBe("words");
    expect(label("clef:clef-flash:lanes:choice:rules")).toBe("words + rules");
    expect(label("clef:clef-flash:lanes:maneuver:rules")).toBe("words + rules + executor");
  });

  it("a manoeuvre decision costs the same as a choice decision; the saving is in fewer calls", () => {
    const choice = decisionCost({ model: "clef-flash", encoder: "lanes", strategy: "choice" });
    const maneuver = decisionCost({ model: "clef-flash", encoder: "lanes", strategy: "maneuver" });
    expect(maneuver.tokens).toBe(choice.tokens);
    expect(choice.measured).toBe(false);
  });

  it("every manoeuvre has an option and a move to report it on; the rules name every move", () => {
    expect(Object.keys(criteriaFor("rules", "maneuver")).sort()).toEqual([...MANEUVER_IDS].sort());
    expect(Object.keys(MANEUVER_ACTION).sort()).toEqual([...MANEUVER_IDS].sort());
    expect(Object.keys(RULES_CRITERIA).sort()).toEqual([...ACTIONS].sort());
    expect(criteriaFor("rules")).toBe(RULES_CRITERIA);
    expect(MANUAL_IDS).toContain("rules");
  });

  it("the rules and options say what the game is and never which move is good in a given state", () => {
    const text = [MANUALS.rules, ...Object.values(RULES_CRITERIA)].join(" ");
    expect(text).not.toMatch(/\bsafe\b|\bunsafe\b|danger|best move|you should/i);
    // Every field the options mention exists in the state.
    const mentioned = [...text.matchAll(/\b(chicken|forward|sideways|backward)\.([a-z_]+)/g)];
    expect(mentioned.length).toBeGreaterThan(10);
    for (const [, group, field] of mentioned) {
      const state = base as unknown as Record<string, Record<string, unknown>>;
      expect(Object.keys(state[group ?? ""] ?? {}), `${group}.${field}`).toContain(field);
    }
  });
});
