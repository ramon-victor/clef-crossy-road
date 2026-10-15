// Downloads the 3D models, textures, audio and font from EvanBacon/Expo-Crossy-Road (MIT code;
// assets replicate the original Crossy Road, see NOTICE and docs/10) into apps/desktop/public/assets.
// The repository does not redistribute them: this script fetches them locally, and they are gitignored.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REVISION = "6f2e84e580c9c8f2b432aa365f706d45d96d8bc9";
const target = resolve(import.meta.dirname, "../apps/desktop/public/assets");
const directories = ["models", "audio", "fonts"];

if (
  directories.every((dir) => existsSync(join(target, dir))) &&
  !process.argv.includes("--force")
) {
  console.log(`assets already present in ${target} (use --force to refetch)`);
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), "ccr-assets-"));
try {
  const git = (...args) => execFileSync("git", args, { cwd: tmp, stdio: "pipe" });
  git("init", "-q");
  git("remote", "add", "origin", "https://github.com/EvanBacon/Expo-Crossy-Road.git");
  git("sparse-checkout", "set", "assets/models", "assets/audio", "assets/fonts");
  git("fetch", "--depth", "1", "--filter=blob:none", "origin", REVISION);
  git("checkout", "-q", "FETCH_HEAD");
  mkdirSync(target, { recursive: true });
  for (const dir of directories) {
    cpSync(join(tmp, "assets", dir), join(target, dir), { recursive: true });
  }
  console.log(`assets copied to ${target} (revision ${REVISION.slice(0, 7)})`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
