import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type EpisodeOptions,
  type EpisodeResult,
  type LatencyModel,
  type PolicyFactory,
  playEpisode,
} from "@ccr/agent";
import type { ClefClient } from "@ccr/clef";
import { ClefError } from "@ccr/clef";

/** Everything about how an episode is played that a run fixes up front (stored in meta.json). */
export type EpisodeSettings = Required<
  Pick<EpisodeOptions, "decisionTicks" | "maxDecisions" | "stallLimit">
> & { latency?: LatencyModel };

export interface RunMeta {
  runId: string;
  createdAt: string;
  episode: EpisodeSettings;
  promptVersion: string;
  note?: string;
}

export interface RunOptions {
  runDir: string;
  policies: PolicyFactory[];
  seeds: number[];
  concurrency: number;
  episode: EpisodeSettings;
  /** Stop starting new episodes once the client has made this many network calls. */
  maxCalls: number;
  client?: ClefClient | undefined;
  log?: (line: string) => void;
}

export interface RunSummary {
  completed: number;
  skipped: number;
  failed: number;
  stoppedBecause: "done" | "budget" | "fatal";
  fatal?: string;
}

export const EPISODES_FILE = "episodes.ndjson";
export const FAILURES_FILE = "failures.ndjson";

const keyOf = (policy: string, seed: number) => `${policy}|${seed}`;

export function readEpisodes(runDir: string): EpisodeResult[] {
  const path = join(runDir, EPISODES_FILE);
  if (!existsSync(path)) return [];
  const episodes: EpisodeResult[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      episodes.push(JSON.parse(line) as EpisodeResult);
    } catch {
      // A truncated last line from an interrupted run is ignored; that episode is simply replayed.
    }
  }
  return episodes;
}

/** Plays every (policy, seed) pair that is not already on disk. Safe to interrupt and re-run. */
export async function runEpisodes(meta: RunMeta, options: RunOptions): Promise<RunSummary> {
  const { runDir, policies, seeds, concurrency, client } = options;
  const log = options.log ?? (() => {});
  mkdirSync(runDir, { recursive: true });
  const metaPath = join(runDir, "meta.json");
  if (!existsSync(metaPath)) writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

  // A run killed mid-write leaves a partial last line; end it so the next record is not glued to it.
  const episodesPath = join(runDir, EPISODES_FILE);
  if (existsSync(episodesPath) && !readFileSync(episodesPath, "utf8").endsWith("\n")) {
    appendFileSync(episodesPath, "\n");
  }
  const done = new Set(readEpisodes(runDir).map((e) => keyOf(e.policy, e.seed)));
  const queue: Array<{ factory: PolicyFactory; seed: number }> = [];
  for (const factory of policies) {
    for (const seed of seeds) {
      if (!done.has(keyOf(factory.id, seed))) queue.push({ factory, seed });
    }
  }
  const skipped = policies.length * seeds.length - queue.length;

  let completed = 0;
  let failed = 0;
  let stopped: RunSummary["stoppedBecause"] = "done";
  let fatal: string | undefined;
  const total = queue.length;

  const worker = async () => {
    for (;;) {
      if (stopped !== "done") return;
      if (client && client.stats().calls >= options.maxCalls) {
        stopped = "budget";
        return;
      }
      const task = queue.shift();
      if (!task) return;
      try {
        const result = await playEpisode(task.factory, task.seed, options.episode);
        appendFileSync(join(runDir, EPISODES_FILE), `${JSON.stringify(result)}\n`);
        completed++;
        if (completed % 10 === 0 || completed === total) {
          const calls = client ? ` | api calls ${client.stats().calls}` : "";
          log(`  ${completed}/${total} episodes${calls}`);
        }
      } catch (error) {
        if (error instanceof ClefError && error.fatal) {
          stopped = "fatal";
          fatal = `${error.kind}: ${error.message}`;
          return;
        }
        failed++;
        appendFileSync(
          join(runDir, FAILURES_FILE),
          `${JSON.stringify({
            policy: task.factory.id,
            seed: task.seed,
            error: error instanceof Error ? error.message : String(error),
          })}\n`,
        );
        log(
          `  ! ${task.factory.id} seed ${task.seed} failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { completed, skipped, failed, stoppedBecause: stopped, ...(fatal ? { fatal } : {}) };
}
