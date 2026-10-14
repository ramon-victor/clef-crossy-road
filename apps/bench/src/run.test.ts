import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alwaysForward, clefPolicy, type PolicyFactory, randomPolicy } from "@ccr/agent";
import { ClefClient, ClefError, type Transport } from "@ccr/clef";
import { afterEach, describe, expect, it } from "vitest";
import {
  EPISODES_FILE,
  FAILURES_FILE,
  type RunMeta,
  type RunOptions,
  readEpisodes,
  runEpisodes,
} from "./run.ts";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "ccr-bench-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const episode = { decisionTicks: 12, maxDecisions: 100, stallLimit: 40 };
const meta = (runId: string, overrides: Partial<RunMeta> = {}): RunMeta => ({
  runId,
  createdAt: "2026-10-14T00:00:00.000Z",
  episode,
  promptVersion: "test",
  ...overrides,
});
const base: Omit<RunOptions, "runDir"> = {
  policies: [alwaysForward],
  seeds: [1],
  concurrency: 1,
  episode,
  maxCalls: 100,
};
const run = (runDir: string, runId: string, overrides: Partial<RunOptions> = {}) =>
  runEpisodes(meta(runId), { ...base, runDir, ...overrides });

const seedsOn = (runDir: string) =>
  readEpisodes(runDir)
    .map((e) => e.seed)
    .sort();

describe("runEpisodes", () => {
  it("writes one record per (policy, seed) and a meta file", async () => {
    const runDir = tempDir();
    const summary = await run(runDir, "t1", {
      policies: [alwaysForward, randomPolicy],
      seeds: [1, 2, 3],
      concurrency: 2,
    });
    expect(summary).toMatchObject({ completed: 6, skipped: 0, failed: 0, stoppedBecause: "done" });
    const episodes = readEpisodes(runDir);
    expect(episodes).toHaveLength(6);
    expect(new Set(episodes.map((e) => e.policy))).toEqual(new Set(["always-forward", "random"]));
    expect(JSON.parse(readFileSync(join(runDir, "meta.json"), "utf8")).runId).toBe("t1");
  });

  it("resumes: a second invocation skips what is on disk and only plays the new seeds", async () => {
    const runDir = tempDir();
    await run(runDir, "t2", { seeds: [1, 2] });
    const second = await run(runDir, "t2", { seeds: [1, 2, 3, 4] });
    expect(second).toMatchObject({ completed: 2, skipped: 2 });
    expect(seedsOn(runDir)).toEqual([1, 2, 3, 4]);
  });

  it("tolerates a truncated last line left by an interrupted run", async () => {
    const runDir = tempDir();
    await run(runDir, "t3");
    appendFileSync(join(runDir, EPISODES_FILE), '{"policy":"always-forward","seed":2,"sco');
    expect(readEpisodes(runDir)).toHaveLength(1);
    const again = await run(runDir, "t3", { seeds: [1, 2] });
    expect(again.completed).toBe(1);
    // The record written after the truncated line must be readable, not glued to the fragment.
    expect(seedsOn(runDir)).toEqual([1, 2]);
  });

  it("stops starting episodes once the API-call budget is spent", async () => {
    const transport: Transport = {
      post: async () => ({
        status: 200,
        json: {
          result: {
            answers: {
              move: { type: "choice", choice: "hop_forward", probabilities: { hop_forward: 1 } },
            },
            usage: { input_tokens: 400, output_tokens: 0 },
          },
        },
      }),
    };
    const client = new ClefClient({ transport, sleep: async () => {} });
    const factory = clefPolicy(client, {
      model: "clef-flash",
      encoder: "json",
      strategy: "choice",
      manual: "full",
    });
    const summary = await run(tempDir(), "t4", {
      policies: [factory],
      seeds: Array.from({ length: 50 }, (_, i) => i + 1),
      maxCalls: 15,
      client,
    });
    expect(summary.stoppedBecause).toBe("budget");
    expect(summary.completed).toBeLessThan(50);
    expect(client.stats().calls).toBeGreaterThanOrEqual(15);
    expect(client.stats().calls).toBeLessThan(15 + 40);
  });
});

describe("failures", () => {
  const failingOn = (seed: number, error: Error): PolicyFactory => ({
    id: "failing",
    create: (episodeSeed) => ({
      kind: "observation",
      id: "failing",
      decide: async () => {
        if (episodeSeed === seed) throw error;
        return { action: "hop_forward" };
      },
    }),
  });

  it("records an episode that fails and keeps going with the others", async () => {
    const runDir = tempDir();
    const summary = await run(runDir, "t5", {
      policies: [failingOn(2, new Error("boom"))],
      seeds: [1, 2, 3],
    });
    expect(summary).toMatchObject({ completed: 2, failed: 1, stoppedBecause: "done" });
    const failure = JSON.parse(readFileSync(join(runDir, FAILURES_FILE), "utf8"));
    expect(failure).toEqual({ policy: "failing", seed: 2, error: "boom" });
  });

  it("stops the whole run on an error that no retry can fix", async () => {
    const summary = await run(tempDir(), "t6", {
      policies: [failingOn(2, new ClefError("auth", "bad token"))],
      seeds: [1, 2, 3, 4],
    });
    expect(summary).toMatchObject({
      completed: 1,
      stoppedBecause: "fatal",
      fatal: "auth: bad token",
    });
  });
});

describe("resuming under other rules", () => {
  it("refuses a run whose episode settings changed, naming what changed", async () => {
    const runDir = tempDir();
    await run(runDir, "t7");
    const changed = meta("t7", { episode: { ...episode, decisionTicks: 6, stallLimit: 0 } });
    await expect(runEpisodes(changed, { ...base, runDir, seeds: [2] })).rejects.toThrow(
      /different episode settings \(decisionTicks, stallLimit\)/,
    );
    expect(seedsOn(runDir)).toEqual([1]);
  });

  it("still resumes a run whose meta file predates a setting", async () => {
    const runDir = tempDir();
    await run(runDir, "t8");
    writeFileSync(
      join(runDir, "meta.json"),
      JSON.stringify({ runId: "t8", episode: { decisionTicks: 12 } }),
    );
    await expect(run(runDir, "t8", { seeds: [1, 2] })).resolves.toMatchObject({ completed: 1 });
  });
});
