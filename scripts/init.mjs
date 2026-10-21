// Prepares a fresh clone in one step: checks Git and Node, makes sure the pinned pnpm runs, installs the
// workspace and downloads Evan Bacon's game assets. It never reads .env and never calls Cloudflare.
// Usage: node scripts/init.mjs [--desktop] [--yes]   (init.sh and init.cmd forward to this file)
//   --desktop  also check the Rust toolchain the Tauri app needs
//   --yes      install the pinned pnpm without asking when it is missing or cannot run
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const pinned = manifest.packageManager.split("@")[1];
const minNode = Number(manifest.engines.node.replace(/[^\d.]/g, "").split(".")[0]);
const args = new Set(process.argv.slice(2));
const windows = process.platform === "win32";
const installer = ["--yes", "get-pnpm@0.0.5", pinned];

const ok = (text) => console.log(`[ok] ${text}`);
const info = (text) => console.log(`[..] ${text}`);
function fail(text, hint) {
  console.error(`[!!] ${text}`);
  if (hint) console.error(`     ${hint}`);
  process.exit(1);
}

// A bare command name on Windows is usually a .cmd shim, which Node only starts through a shell. The
// arguments here are fixed strings, so joining them into one command line is safe.
function run(command, commandArgs, { capture = false } = {}) {
  const stdio = capture ? "pipe" : "inherit";
  const shell = windows && !/[\\/]/.test(command);
  const result = shell
    ? spawnSync([command, ...commandArgs].join(" "), { cwd: root, stdio, shell: true })
    : spawnSync(command, commandArgs, { cwd: root, stdio });
  return { status: result.status, stdout: result.stdout?.toString().trim() ?? "" };
}

function version(command) {
  const result = run(command, ["--version"], { capture: true });
  return result.status === 0 ? result.stdout.split(/\r?\n/).pop() : null;
}

// Where `pnpm setup` (run by the official installer) puts the executable when PNPM_HOME is not set.
function installedPnpm() {
  const home =
    process.env.PNPM_HOME ??
    (windows
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "pnpm")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "pnpm")
        : join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "pnpm"));
  const exe = windows ? "pnpm.exe" : "pnpm";
  return [join(home, exe), join(home, "bin", exe)].find(
    (path) => existsSync(path) && version(path) === pinned,
  );
}

async function consent(question) {
  if (args.has("--yes")) return true;
  if (!process.stdin.isTTY) return false;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`${question} [Y/n] `);
  prompt.close();
  return !/^n/i.test(answer.trim());
}

const node = process.versions.node;
if (Number(node.split(".")[0]) < minNode) {
  fail(
    `Node ${node} is too old; this project needs Node ${minNode} or newer.`,
    "https://nodejs.org",
  );
}
ok(`Node ${node}`);

const git = version("git");
if (!git) fail("Git was not found; it downloads the game assets.", "https://git-scm.com/downloads");
ok(git);

let pnpm = "pnpm";
let reopen = false;
const found = version(pnpm);
if (found === pinned) {
  ok(`pnpm ${pinned}`);
} else {
  const why = found
    ? `pnpm ${found} is installed, not ${pinned}`
    : `pnpm is missing or cannot start ${pinned}`;
  const command = `npx ${installer.join(" ")}`;
  if (
    !(await consent(`${why}. Install pnpm ${pinned} with the official installer (${command})?`))
  ) {
    fail(`${why}.`, `Install it with: ${command}  (then open a new terminal)`);
  }
  if (run("npx", installer).status !== 0) {
    fail("The pnpm installer failed.", "https://pnpm.io/installation");
  }
  pnpm = installedPnpm();
  if (!pnpm) {
    fail(`pnpm ${pinned} was installed but not found.`, "Open a new terminal and run init again.");
  }
  reopen = true;
  ok(`pnpm ${pinned} at ${pnpm}`);
}

info("pnpm install --frozen-lockfile");
if (run(pnpm, ["install", "--frozen-lockfile"]).status !== 0) fail("pnpm install failed.");
ok("dependencies installed");

info("fetching the game assets (Evan Bacon's Expo-Crossy-Road, pinned revision)");
if (run(process.execPath, [join(root, "scripts", "fetch-assets.mjs")]).status !== 0) {
  fail("Could not download the assets.", "Check the internet connection and run init again.");
}
ok("assets ready");

if (args.has("--desktop")) {
  const cargo = version("cargo");
  const rustc = version("rustc");
  if (cargo && rustc) ok(`${rustc}, ${cargo}`);
  else console.log("[!!] Rust was not found: install it from https://rustup.rs");
  console.log("     The desktop app also needs the Tauri prerequisites for your system:");
  console.log("     https://v2.tauri.app/start/prerequisites/");
}

console.log(`
Ready. Next:
  pnpm run dev            browser app at http://localhost:5173 (free look-ahead player)
  pnpm run dev:desktop    desktop app (needs Rust; run init with --desktop to check)
To let Clef play, add a Cloudflare token in Controls > Cloudflare > Configure,
or copy .env.example to .env and fill it in.`);
if (reopen) {
  console.log(`Open a new terminal so that \`pnpm\` finds pnpm ${pinned}. If \`pnpm --version\` still fails,
an older pnpm comes first on PATH (\`${windows ? "where" : "which -a"} pnpm\`): remove it, for
example with \`npm uninstall -g pnpm\`.`);
}
