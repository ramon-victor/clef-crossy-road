import { adler32, crc32 } from "./png.ts";

export interface DecodedPng {
  width: number;
  height: number;
  paletteSize: number;
  /** Palette index of every pixel, row by row. */
  pixels: Uint8Array;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * An independent reader for what `encodePng` writes, so tests can verify the structure, the CRC of
 * every chunk, the stored deflate blocks and the pixels without trusting the writer.
 */
export function decodePng(png: Uint8Array): DecodedPng {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  check(
    signature.every((byte, i) => png[i] === byte),
    "bad PNG signature",
  );
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let paletteSize = 0;
  const idat: Uint8Array[] = [];
  const types: string[] = [];
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    check(
      crc32(png.subarray(offset + 4, offset + 8 + length)) === view.getUint32(offset + 8 + length),
      `bad CRC in ${type}`,
    );
    types.push(type);
    if (type === "IHDR") {
      const header = new DataView(data.buffer, data.byteOffset);
      width = header.getUint32(0);
      height = header.getUint32(4);
      check(
        [8, 3, 0, 0, 0].every((byte, i) => data[8 + i] === byte),
        "IHDR is not 8-bit palette",
      );
    }
    if (type === "PLTE") paletteSize = length / 3;
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  check(types.join() === "IHDR,PLTE,IDAT,IEND", `unexpected chunks: ${types.join()}`);

  const z = idat[0] as Uint8Array;
  check(z[0] === 0x78, "bad zlib header");
  const raw: number[] = [];
  let o = 2;
  for (;;) {
    const final = (z[o] as number) & 1;
    const size = (z[o + 1] as number) | ((z[o + 2] as number) << 8);
    const complement = (z[o + 3] as number) | ((z[o + 4] as number) << 8);
    check((size ^ 0xffff) === complement, "stored block length complement");
    o += 5;
    for (let i = 0; i < size; i++) raw.push(z[o + i] as number);
    o += size;
    if (final) break;
  }
  check(
    adler32(Uint8Array.from(raw)) === new DataView(z.buffer, z.byteOffset).getUint32(o),
    "bad Adler-32",
  );

  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    check(raw[y * (width + 1)] === 0, "scanline filter is not none");
    for (let x = 0; x < width; x++) pixels[y * width + x] = raw[y * (width + 1) + 1 + x] as number;
  }
  return { width, height, paletteSize, pixels };
}
