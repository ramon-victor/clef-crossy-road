import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PolicyFactory } from "@ccr/agent";
import { type ClefClient, ClefError } from "@ccr/clef";
import { appendNdjson, endPartialLine, readNdjson } from "@ccr/clef/node";
import { observe } from "@ccr/core";
import { type ProbeResult, type ProbeState, rebuild } from "./probe.ts";

export const PROBE_STATES_FILE = "states.ndjson";
export const PROBE_RESULTS_FILE = "results.ndjson";

export interface ProbeRunOptions {
  /** Folder of this probe run, where `results.ndjson` goes. */
  runDir: string;
  states: readonly ProbeState[];
  policies: readonly PolicyFactory[];
  concurrency: number;
  /** Stop starting questions once the client has made this many network calls. */
  maxCalls: number;
  client?: ClefClient | undefined;
  log?: (line: string) => void;
}

export interface ProbeRunSummary {
  asked: number;
  skipped: number;
  failed: number;
  stoppedBecause: "done" | "budget" | "fatal";
  fatal?: string;
}

export const readProbeResults = (runDir: string): ProbeResult[] =>
  readNdjson(join(runDir, PROBE_RESULTS_FILE)) as ProbeResult[];

const keyOf = (policy: string, state: string): string => `${policy}|${state}`;

/**
 * Asks every policy about every state it has not answered yet, one question each. Resumable: an
 * interrupted run only repeats what is not on disk, and cached answers cost nothing. A model reads the
 * observation and the memory the state's own history gives it, and nothing else: the labels stay out.
 */
export async function runProbe(options: ProbeRunOptions): Promise<ProbeRunSummary> {
  const { runDir, states, policies, client } = options;
  const log = options.log ?? (() => {});
  mkdirSync(runDir, { recursive: true });
  const resultsPath = join(runDir, PROBE_RESULTS_FILE);
  endPartialLine(resultsPath);
  const done = new Set(readProbeResults(runDir).map((r) => keyOf(r.policy, r.state)));
  const queue = policies.flatMap((factory) =>
    states.filter((s) => !done.has(keyOf(factory.id, s.id))).map((state) => ({ factory, state })),
  );
  const skipped = policies.length * states.length - queue.length;

  let asked = 0;
  let failed = 0;
  let stopped: ProbeRunSummary["stoppedBecause"] = "done";
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
        const policy = task.factory.create(task.state.seed);
        if (policy.kind !== "observation")
          throw new Error(`${task.factory.id} reads the simulator`);
        const { game, memory } = rebuild(task.state);
        const decision = await policy.decide(observe(game), memory);
        const result: ProbeResult = {
          policy: task.factory.id,
          state: task.state.id,
          action: decision.action,
          ...(decision.probabilities ? { probabilities: decision.probabilities } : {}),
          ...(decision.inputTokens === undefined ? {} : { inputTokens: decision.inputTokens }),
          ...(decision.neurons === undefined ? {} : { neurons: decision.neurons }),
          ...(decision.cached === undefined ? {} : { cached: decision.cached }),
        };
        appendNdjson(resultsPath, result);
        asked++;
        if (asked % 10 === 0 || asked === total) {
          const calls = client ? ` | api calls ${client.stats().calls}` : "";
          log(`  ${asked}/${total} answers${calls}`);
        }
      } catch (error) {
        if (error instanceof ClefError && error.fatal) {
          stopped = "fatal";
          fatal = `${error.kind}: ${error.message}`;
          return;
        }
        failed++;
        log(
          `  ! ${task.factory.id} on ${task.state.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
  return { asked, skipped, failed, stoppedBecause: stopped, ...(fatal ? { fatal } : {}) };
}
