import { Game, type Observation, observe } from "@ccr/core";
import {
  carAt,
  logAt,
  padAt,
  railRow,
  roadRow,
  rowsGenerator,
  trainAt,
  waterRow,
} from "@ccr/core/testing";
import { describe, expect, it } from "vitest";
import { encodeRequest } from "./encode.ts";
import { PALETTE_INDEX as C, IMAGE_COLS, renderSceneImage } from "./image.ts";
import { type DecodedPng, decodePng } from "./png-decoder.testing.ts";

const at = (d: DecodedPng, x: number, y: number) =>
  d.pixels[Math.round(y) * d.width + Math.round(x)];
/** Pixel centre of column `col` and the row `dz` ahead of the chicken, for the default window. */
const cell = (col: number, dz: number) => ({ x: (col + 6.5) * 32, y: (8 - dz) * 32 + 16 });

function world(rows: Parameters<typeof rowsGenerator>[0]): { game: Game; obs: Observation } {
  const game = new Game({ seed: 1, generator: rowsGenerator(rows) });
  return { game, obs: observe(game) };
}

describe("scene image (E2)", () => {
  it("is 13 x 12 patches of 32 px, i.e. 416 x 384, and a valid PNG", () => {
    const { obs } = world({});
    const image = renderSceneImage(obs);
    expect([image.width, image.height]).toEqual([13 * 32, 12 * 32]);
    expect(IMAGE_COLS).toBe(13);
    const decoded = decodePng(image.png);
    expect([decoded.width, decoded.height]).toEqual([416, 384]);
    expect(image.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    // 13 x 12 patches + 3 marker tokens, per the service's tokenizer description
    expect((image.width / 32) * (image.height / 32) + 3).toBe(159);
  });

  it("draws the chicken on its own row at its column, and the terrain around it", () => {
    const { obs } = world({
      9: roadRow(9, [carAt(0, 0.05)]),
      10: waterRow(10, [logAt(-2, 0), padAt(3)], "logs"),
      11: railRow(11, trainAt(0)),
    });
    const d = decodePng(renderSceneImage(obs).png);

    const me = cell(0, 0);
    expect(at(d, me.x, me.y)).toBe(C.chicken);
    expect(at(d, me.x - 12, me.y - 12)).toBe(C.outline);
    expect(at(d, cell(0, -1).x - 14, cell(0, -1).y)).toBe(C.grass);

    expect(at(d, cell(-5, 1).x, cell(-5, 1).y - 12)).toBe(C.road);
    const road = cell(0, 1);
    expect([C.vehicle, C.white]).toContain(at(d, road.x, road.y - 8));
    expect(at(d, cell(5, 2).x, cell(5, 2).y - 12)).toBe(C.water);
    expect(at(d, cell(2, 2).x + 20, cell(2, 2).y)).toBe(C.log);
    expect(at(d, cell(-3, 2).x, cell(-3, 2).y)).toBe(C.pad);
    expect(at(d, cell(5, 3).x, cell(5, 3).y - 14)).toBe(C.bed);
  });

  it("flips the chicken with the camera axis: col +1 is to the right", () => {
    const game = new Game({ seed: 1, generator: rowsGenerator({}) });
    game.step("hop_right"); // upstream x -1 = col +1
    const d = decodePng(renderSceneImage(observe(game)).png);
    const right = cell(1, 0);
    const left = cell(-1, 0);
    expect(at(d, right.x, right.y)).toBe(C.chicken);
    expect(at(d, left.x, left.y)).not.toBe(C.chicken);
  });

  it("draws a velocity streak behind a moving car, on the side it came from", () => {
    // Car at col 0 moving to larger col (screen right) at 3 cols/s: the streak trails to its left.
    const speedPerTick = -3 / 60; // upstream x is negated
    const { obs } = world({ 9: roadRow(9, [carAt(0, speedPerTick)]) });
    const d = decodePng(renderSceneImage(obs).png);
    const row = cell(0, 1);
    const behind = at(d, row.x - 1.25 * 32 - 20, row.y);
    const ahead = at(d, row.x + 1.25 * 32 + 20, row.y);
    expect(behind).toBe(C.streak);
    expect(ahead).toBe(C.road);
  });

  it("lights the rail warning dot only while the light is on", () => {
    const train = trainAt(0, 0.8, 110);
    const game = new Game({ seed: 1, generator: rowsGenerator({ 9: railRow(9, train) }) });
    const rowY = cell(0, 1).y;
    const off = decodePng(renderSceneImage(observe(game)).png);
    expect(at(off, 12, rowY)).toBe(C.lightOff);
    game.advance(train.firstWrapTick);
    const on = decodePng(renderSceneImage(observe(game)).png);
    expect(at(on, 12, rowY)).toBe(C.lightOn);
  });

  it("is a pure function of the observation: identical input, identical bytes", () => {
    const { obs } = world({ 9: roadRow(9, [carAt(3, 0.04)]) });
    expect(renderSceneImage(obs).dataUrl).toBe(renderSceneImage(structuredClone(obs)).dataUrl);
  });
});

describe("image request", () => {
  it("attaches the picture and a plain-text state with no numbers about the world", () => {
    const { obs } = world({ 9: roadRow(9, [carAt(0)]) });
    const request = encodeRequest("image", obs);
    expect(request.images).toHaveLength(1);
    expect(request.images?.[0]?.startsWith("data:image/png;base64,")).toBe(true);
    expect(request.state).toBe("The current view of the world is the attached picture.");
  });

  it("the other encoders attach no images", () => {
    const { obs } = world({});
    expect(encodeRequest("json", obs).images).toBeUndefined();
    expect(encodeRequest("grid", obs).images).toBeUndefined();
  });
});
