// Exports the approved Neural Pilot artwork for desktop and browser use. Requires pnpm install.
// Keep source.png as the master: rebuilding icons must never replace the artwork with a drawing.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const desktop = resolve(import.meta.dirname, "../apps/desktop");
const icons = join(desktop, "src-tauri/icons");
const source = join(icons, "source.png");
const publicDir = join(desktop, "public");
const cli = join(desktop, "node_modules/@tauri-apps/cli/tauri.js");
const master = readFileSync(source);
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (
  master.length < 33 ||
  !master.subarray(0, 8).equals(pngSignature) ||
  master.readUInt32BE(16) !== 1024 ||
  master.readUInt32BE(20) !== 1024 ||
  master[24] !== 8 ||
  master[25] !== 6
) {
  throw new Error("The icon master must be a 1024x1024, 8-bit RGBA PNG.");
}

const temporary = mkdtempSync(join(tmpdir(), "ccr-icons-"));
const generate = (output, extra = []) =>
  execFileSync(process.execPath, [cli, "icon", source, "--output", output, ...extra], {
    cwd: desktop,
    stdio: "inherit",
  });

try {
  const native = join(temporary, "desktop");
  const web = join(temporary, "web");
  generate(native);
  // Tauri emits ICNS entries in varying order. Keep exports stable, with legacy masks after RGB data.
  const icnsPath = join(native, "icon.icns");
  const icns = readFileSync(icnsPath);
  const entries = [];
  for (let offset = 8; offset < icns.length; ) {
    const length = icns.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > icns.length) throw new Error("Invalid ICNS entry length.");
    entries.push(icns.subarray(offset, offset + length));
    offset += length;
  }
  const maskOwners = { s8mk: "is32", l8mk: "il32", h8mk: "ih32", t8mk: "it32" };
  const entryKey = (entry) => {
    const type = entry.toString("ascii", 0, 4);
    return Buffer.from(maskOwners[type] ? `${maskOwners[type]}-mask` : type);
  };
  entries.sort((a, b) => Buffer.compare(entryKey(a), entryKey(b)));
  writeFileSync(icnsPath, Buffer.concat([icns.subarray(0, 8), ...entries]));
  // Tauri also exports mobile directories; this app only needs the desktop files at the root.
  for (const entry of readdirSync(native, { withFileTypes: true })) {
    if (entry.isFile()) copyFileSync(join(native, entry.name), join(icons, entry.name));
  }
  generate(web, ["--png", "16", "--png", "32", "--png", "48"]);
  mkdirSync(publicDir, { recursive: true });
  for (const size of [16, 32]) {
    copyFileSync(join(web, `${size}x${size}.png`), join(publicDir, `favicon-${size}x${size}.png`));
  }

  // A compact favicon ICO with three PNG frames; the native ICO also contains larger desktop sizes.
  const sizes = [16, 32, 48];
  const frames = sizes.map((size) => readFileSync(join(web, `${size}x${size}.png`)));
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2); // ICO image type
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    directory[entry] = size;
    directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4); // planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(frames[index].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += frames[index].length;
  });
  writeFileSync(join(publicDir, "favicon.ico"), Buffer.concat([directory, ...frames]));
  console.log("Updated desktop icons and favicons from icons/source.png.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
