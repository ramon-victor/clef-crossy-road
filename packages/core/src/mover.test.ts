import { describe, expect, it } from "vitest";
import { createMover, type Mover, moverWrapped, moverX, trainLightOn } from "./mover.ts";
import { createRng } from "./rng.ts";
import { carAt, trainAt } from "./testing.ts";

/** The literal upstream update rule, applied one tick at a time. */
function stepwise(m: Mover, ticks: number) {
  const out: { x: number; wrapped: boolean }[] = [{ x: m.x0, wrapped: false }];
  let x = m.x0;
  for (let i = 1; i <= ticks; i++) {
    x += m.speed;
    let wrapped = false;
    if (x > m.wrapOffset && m.speed > 0) {
      x = -m.wrapOffset;
      wrapped = true;
    } else if (x < -m.wrapOffset && m.speed < 0) {
      x = m.wrapOffset;
      wrapped = true;
    }
    out.push({ x, wrapped });
  }
  return out;
}

describe("mover closed form", () => {
  it("matches the stepwise upstream rule for random cars and trains", () => {
    const rng = createRng(2024, 1);
    for (let trial = 0; trial < 200; trial++) {
      const dir = rng.next() > 0.5 ? -1 : 1;
      const speed = (rng.next() * 0.06 + 0.02) * dir;
      const x0 = -6 * dir - rng.next() * 8 * dir;
      const m = createMover({ kind: "car", variant: 0, width: 2, speed, x0, wrapOffset: 11 });
      const ref = stepwise(m, 1500);
      for (let n = 0; n <= 1500; n++) {
        expect(moverX(m, n)).toBeCloseTo(ref[n]?.x ?? Number.NaN, 6);
        expect(moverWrapped(m, n)).toBe(ref[n]?.wrapped);
      }
    }
    for (let trial = 0; trial < 50; trial++) {
      const t = trainAt(rng.next() * 220 - 110);
      const ref = stepwise(t, 1500);
      for (let n = 0; n <= 1500; n++) {
        expect(moverX(t, n)).toBeCloseTo(ref[n]?.x ?? Number.NaN, 6);
        expect(moverWrapped(t, n)).toBe(ref[n]?.wrapped);
      }
    }
  });

  it("never moves static movers (lily pads)", () => {
    const pad = carAt(-3, 0);
    expect(moverX(pad, 0)).toBe(-3);
    expect(moverX(pad, 100_000)).toBe(-3);
    expect(moverWrapped(pad, 100_000)).toBe(false);
  });

  it("keeps the upstream hit zone: hero half-width + width/2 - 0.1", () => {
    expect(carAt(0, 0, 2).halfExtent).toBeCloseTo(1.25, 12);
    expect(carAt(0, 0, 1).halfExtent).toBeCloseTo(0.75, 12);
    expect(carAt(0, 0, 3).halfExtent).toBeCloseTo(1.75, 12);
    expect(trainAt(0).halfExtent).toBeCloseTo(10.25, 12);
    expect(trainAt(0, 0.8, 110, 3).halfExtent).toBeCloseTo(12.75, 12);
  });

  it("rings the train light for 180 ticks after each wrap and not before the first", () => {
    const t = trainAt(0); // first wrap after floor(110 / 0.8) + 1 = 138 updates
    expect(t.firstWrapTick).toBe(138);
    expect(trainLightOn(t, 0)).toBe(false);
    expect(trainLightOn(t, 137)).toBe(false);
    expect(trainLightOn(t, 138)).toBe(true);
    expect(trainLightOn(t, 138 + 179)).toBe(true);
    expect(trainLightOn(t, 138 + 180)).toBe(false);
    // Period is floor(220 / 0.8) + 1 = 276 updates, so the light rings again at the next wrap.
    expect(t.period).toBe(276);
    expect(trainLightOn(t, 138 + 276)).toBe(true);
  });
});
