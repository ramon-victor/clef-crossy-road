import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { EpisodeResult } from "@ccr/agent";
import { FileBudget } from "@ccr/clef/node";
import { readEpisodes } from "./run.ts";

/** Where this project keeps what it spends and what it has already asked the models. */
export const LEDGER_FILE = join("runs", "cache", "spend.ndjson");
export const CACHE_FILE = join("runs", "cache", "clef.ndjson");

export const runDir = (root: string, name: string): string => join(root, "runs", name);

export function loadEpisodes(root: string, names: readonly string[]): EpisodeResult[] {
  return names.flatMap((name) => readEpisodes(runDir(root, name)));
}

/** A view of the shared spend ledger for the account in `CF_ACCOUNT_ID`. */
export function openBudget(root: string, dailyLimit: number): FileBudget {
  return new FileBudget(
    resolve(root, LEDGER_FILE),
    dailyLimit,
    undefined,
    process.env.CF_ACCOUNT_ID,
  );
}

/** Writes `text` to `out` (relative to the workspace root), creating folders. Returns the full path. */
export function writeOutput(root: string, out: string, text: string): string {
  const target = resolve(root, out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  return target;
}
