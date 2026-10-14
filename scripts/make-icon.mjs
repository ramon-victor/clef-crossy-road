// Generates a 1024x1024 source icon (our own artwork: a chicken-ish blob on sky blue) as a PNG,
// with no dependencies. Feed it to `tauri icon` to produce every platform size.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const out = resolve(process.argv[2] ?? "apps/desktop/src-tauri/icons/source.png");
const N = 1024;
const px = new Uint8Array(N * N * 4);

const BLUE = [135, 198, 255];
const GRASS = [110, 190, 90];
const WHITE = [250, 250, 250];
const YELLOW = [255, 214, 64];
const ORANGE = [255, 140, 40];
const RED = [220, 50, 50];
const BLACK = [30, 30, 30];

const inRoundedRect = (x, y, r) => {
  const dx = Math.max(Math.abs(x - N / 2) - (N / 2 - r), 0);
  const dy = Math.max(Math.abs(y - N / 2) - (N / 2 - r), 0);
  return dx * dx + dy * dy <= r * r;
};
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const inTri = (x, y, a, b, c) => {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const p = [x, y];
  const d1 = s(p, a, b),
    d2 = s(p, b, c),
    d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    let color = null;
    if (inRoundedRect(x, y, 200)) {
      color = y > 760 ? GRASS : BLUE;
      if (inCircle(x, y, 512, 560, 270)) color = WHITE; // body
      if (inCircle(x, y, 690, 400, 150)) color = WHITE; // head
      if (inRect(x, y, 660, 240, 720, 300)) color = RED; // comb
      if (inCircle(x, y, 690, 255, 45)) color = RED;
      if (inTri(x, y, [790, 380], [790, 450], [900, 415])) color = ORANGE; // beak
      if (inCircle(x, y, 725, 385, 22)) color = BLACK; // eye
      if (inRect(x, y, 450, 800, 480, 880) || inRect(x, y, 560, 800, 590, 880)) color = YELLOW; // legs
      if (inTri(x, y, [330, 540], [470, 480], [470, 650])) color = [235, 235, 235]; // wing shade
    }
    const i = (y * N + x) * 4;
    if (color) px.set([...color, 255], i);
  }
}

// PNG encoder
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0; // filter: none
  Buffer.from(px.buffer, y * N * 4, N * 4).copy(raw, y * (N * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
