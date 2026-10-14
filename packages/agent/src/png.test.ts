import { describe, expect, it } from "vitest";
import { adler32, crc32, encodePng, type Rgb, toBase64 } from "./png.ts";
import { decodePng } from "./png-decoder.testing.ts";

const PALETTE: readonly Rgb[] = Array.from({ length: 19 }, (_, i): Rgb => [i, i * 2, i * 3]);

describe("PNG writer", () => {
  it("produces a structurally valid palette PNG whose pixels round-trip", () => {
    const pixels = Uint8Array.from({ length: 7 * 5 }, (_, i) => i % 19);
    const decoded = decodePng(encodePng(7, 5, pixels, PALETTE));
    expect([decoded.width, decoded.height, decoded.paletteSize]).toEqual([7, 5, 19]);
    expect([...decoded.pixels]).toEqual([...pixels]);
  });

  it("splits large images into several stored blocks and still decodes", () => {
    const pixels = new Uint8Array(300 * 300).map((_, i) => (i * 7) % 19);
    const decoded = decodePng(encodePng(300, 300, pixels, PALETTE)); // 90,300 raw bytes > one 65,535 block
    expect([...decoded.pixels]).toEqual([...pixels]);
  });

  it("matches the reference CRC-32 and Adler-32 values", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(adler32(new TextEncoder().encode("Wikipedia"))).toBe(0x11e60398);
  });

  it("base64-encodes inputs longer than one conversion chunk", () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
