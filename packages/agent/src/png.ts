/**
 * Minimal PNG writer for 8-bit palette images, using uncompressed ("stored") deflate blocks. Small,
 * deterministic and dependency free, so it runs in Node and in the webview alike.
 */

export type Rgb = readonly [number, number, number];

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const STORED_BLOCK_MAX = 65_535;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (value: number): number[] => [
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 8 + data.length);
  return out;
}

function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / STORED_BLOCK_MAX));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i++) {
    const start = i * STORED_BLOCK_MAX;
    const size = Math.min(STORED_BLOCK_MAX, raw.length - start);
    out[o++] = i === blocks - 1 ? 1 : 0; // BFINAL, BTYPE = 00 (stored)
    out[o++] = size & 255;
    out[o++] = size >>> 8;
    out[o++] = ~size & 255;
    out[o++] = (~size >>> 8) & 255;
    out.set(raw.subarray(start, start + size), o);
    o += size;
  }
  out.set(u32(adler32(raw)), o);
  return out;
}

/** `indices` holds one palette index per pixel, row by row. */
export function encodePng(
  width: number,
  height: number,
  indices: Uint8Array,
  palette: readonly Rgb[],
): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    raw.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const header = new Uint8Array([...u32(width), ...u32(height), 8, 3, 0, 0, 0]);
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach((rgb, i) => {
    plte.set(rgb, i * 3);
  });
  const parts = [
    new Uint8Array(SIGNATURE),
    chunk("IHDR", header),
    chunk("PLTE", plte),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
