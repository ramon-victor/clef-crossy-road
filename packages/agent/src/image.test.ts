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
import {
  adler32,
  PALETTE_INDEX as C,
  crc32,
  encodePng,
  IMAGE_COLS,
  renderSceneImage,
} from "./image.ts";

interface Decoded {
  width: number;
  height: number;
  palette: number;
  pixels: Uint8Array; // palette indices, row major
}

/** Independent PNG reader for what encodePng writes: verifies structure, CRCs and zlib stored blocks. */
function decode(png: Uint8Array): Decoded {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  expect([...png.subarray(0, 8)]).toEqual(signature);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let palette = 0;
  const idat: Uint8Array[] = [];
  const types: string[] = [];
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = view.getUint32(offset + 8 + length);
    expect(crc32(png.subarray(offset + 4, offset + 8 + length)), `CRC of ${type}`).toBe(crc);
    types.push(type);
    if (type === "IHDR") {
      width = new DataView(data.buffer, data.byteOffset).getUint32(0);
      height = new DataView(data.buffer, data.byteOffset).getUint32(4);
      expect([data[8], data[9], data[10], data[11], data[12]]).toEqual([8, 3, 0, 0, 0]);
    }
    if (type === "PLTE") palette = length / 3;
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  expect(types).toEqual(["IHDR", "PLTE", "IDAT", "IEND"]);

  const z = idat[0] as Uint8Array;
  expect(z[0]).toBe(0x78);
  const raw: number[] = [];
  let o = 2;
  for (;;) {
    const final = (z[o] as number) & 1;
    const size = (z[o + 1] as number) | ((z[o + 2] as number) << 8);
    const complement = (z[o + 3] as number) | ((z[o + 4] as number) << 8);
    expect(size ^ 0xffff, "stored block length complement").toBe(complement);
    o += 5;
    for (let i = 0; i < size; i++) raw.push(z[o + i] as number);
    o += size;
    if (final) break;
  }
  const checksum = new DataView(z.buffer, z.byteOffset).getUint32(o);
  expect(adler32(Uint8Array.from(raw))).toBe(checksum);

  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width + 1)]).toBe(0); // filter none
    for (let x = 0; x < width; x++) pixels[y * width + x] = raw[y * (width + 1) + 1 + x] as number;
  }
  return { width, height, palette, pixels };
}

const at = (d: Decoded, x: number, y: number) => d.pixels[Math.round(y) * d.width + Math.round(x)];
/** Pixel centre of column `col` and the row `dz` ahead of the chicken, for the default window. */
const cell = (col: number, dz: number) => ({ x: (col + 6.5) * 32, y: (8 - dz) * 32 + 16 });

function world(rows: Parameters<typeof rowsGenerator>[0]): { game: Game; obs: Observation } {
  const game = new Game({ seed: 1, generator: rowsGenerator(rows) });
  return { game, obs: observe(game) };
}

describe("PNG writer", () => {
  it("produces a structurally valid palette PNG whose pixels round-trip", () => {
    const pixels = Uint8Array.from({ length: 7 * 5 }, (_, i) => i % 19);
    const decoded = decode(encodePng(7, 5, pixels));
    expect([decoded.width, decoded.height, decoded.palette]).toEqual([7, 5, 19]);
    expect([...decoded.pixels]).toEqual([...pixels]);
  });

  it("splits large images into several stored blocks and still decodes", () => {
    const pixels = new Uint8Array(300 * 300).map((_, i) => (i * 7) % 19);
    const decoded = decode(encodePng(300, 300, pixels)); // 90,300 raw bytes > one 65,535 block
    expect([...decoded.pixels.subarray(0, 50)]).toEqual([...pixels.subarray(0, 50)]);
    expect(decoded.pixels[decoded.pixels.length - 1]).toBe(pixels[pixels.length - 1]);
  });

  it("matches the reference CRC-32 and Adler-32 values", () => {
    const text = new TextEncoder().encode("123456789");
    expect(crc32(text)).toBe(0xcbf43926);
    expect(adler32(new TextEncoder().encode("Wikipedia"))).toBe(0x11e60398);
  });
});

describe("scene image (E2)", () => {
  it("is 13 x 12 patches of 32 px, i.e. 416 x 384, and a valid PNG", () => {
    const { obs } = world({});
    const image = renderSceneImage(obs);
    expect([image.width, image.height]).toEqual([13 * 32, 12 * 32]);
    expect(IMAGE_COLS).toBe(13);
    const decoded = decode(image.png);
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
    const d = decode(renderSceneImage(obs).png);

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
    const d = decode(renderSceneImage(observe(game)).png);
    const right = cell(1, 0);
    const left = cell(-1, 0);
    expect(at(d, right.x, right.y)).toBe(C.chicken);
    expect(at(d, left.x, left.y)).not.toBe(C.chicken);
  });

  it("draws a velocity streak behind a moving car, on the side it came from", () => {
    // Car at col 0 moving to larger col (screen right) at 3 cols/s: the streak trails to its left.
    const speedPerTick = -3 / 60; // upstream x is negated
    const { obs } = world({ 9: roadRow(9, [carAt(0, speedPerTick)]) });
    const d = decode(renderSceneImage(obs).png);
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
    const off = decode(renderSceneImage(observe(game)).png);
    expect(at(off, 12, rowY)).toBe(C.lightOff);
    game.advance(train.firstWrapTick);
    const on = decode(renderSceneImage(observe(game)).png);
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
