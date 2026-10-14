import type { Observation, ObsRow } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { ruleView, ruleViewFx } from "./rule.ts";

const grass = (dz: number, blocked: number[] = []): ObsRow => ({
  dz,
  kind: "grass",
  blocked_cols: blocked,
});

function worldWith(...rows: ObsRow[]): Observation {
  return {
    player: { col: 0, standing_on: "grass", riding: false, hop_ticks_left: 0 },
    rows: [grass(-1), grass(0), ...rows],
  };
}

async function play(factory: typeof ruleView, obs: Observation) {
  const policy = factory.create(1);
  if (policy.kind !== "observation") throw new Error("expected an observation policy");
  return (await policy.decide(obs)).action;
}

describe("the scripted players", () => {
  it("only get what a model would: the observation and the memory, never the simulator", () => {
    expect(ruleView.create(1).kind).toBe("observation");
    expect(ruleViewFx.create(1).kind).toBe("observation");
  });

  it("hop forward when the cell ahead is open", async () => {
    const obs = worldWith(grass(1), grass(2));
    expect(await play(ruleView, obs)).toBe("hop_forward");
    expect(await play(ruleViewFx, obs)).toBe("hop_forward");
  });

  it("slide to the nearest open cell when a tree is straight ahead", async () => {
    const obs = worldWith(grass(1, [0, 1]), grass(2));
    expect(await play(ruleView, obs)).toBe("hop_left"); // column -1 is open, +1 is a tree too
  });

  it("do not hop into water and slide towards a lily pad instead", async () => {
    const obs = worldWith({
      dz: 1,
      kind: "water",
      platforms: [{ col: 2, half_extent: 0.75, speed_cols_per_s: 0, type: "lily_pad" }],
    });
    expect(await play(ruleView, obs)).toBe("hop_right");
  });

  it("wait at the edge of the water when no platform is in reach", async () => {
    const obs = worldWith({ dz: 1, kind: "water", platforms: [] });
    expect(await play(ruleView, obs)).toBe("stay");
  });

  it("stay off a rail row while the warning light is on", async () => {
    const obs = worldWith({
      dz: 1,
      kind: "rail",
      train: { col: 100, half_extent: 10.25, speed_cols_per_s: 48 },
      warning_light: "on",
    });
    expect(await play(ruleView, obs)).not.toBe("hop_forward");
  });

  it("only the forecast player sees a car that is about to arrive", async () => {
    // Now the car covers columns -2.85 to -0.35, so column 0 is clear; when the hop lands, 0.8 columns
    // later, it covers -2.05 to 0.45.
    const car: ObsRow = {
      dz: 1,
      kind: "road",
      vehicles: [{ col: -1.6, half_extent: 1.25, speed_cols_per_s: 4 }],
    };
    expect(await play(ruleView, worldWith(car))).toBe("hop_forward");
    expect(await play(ruleViewFx, worldWith(car))).not.toBe("hop_forward");
  });

  it("know a log is carrying them: they keep their footing while riding", async () => {
    const obs: Observation = {
      player: { col: 0.5, standing_on: "water", riding: true, hop_ticks_left: 0 },
      rows: [
        grass(-1),
        {
          dz: 0,
          kind: "water",
          platforms: [{ col: 0.5, half_extent: 1.25, speed_cols_per_s: 1, type: "log" }],
        },
        { dz: 1, kind: "water", platforms: [] },
      ],
    };
    expect(await play(ruleView, obs)).toBe("stay");
  });
});
