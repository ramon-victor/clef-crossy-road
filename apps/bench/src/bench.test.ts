import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alwaysForward, clefPolicy, randomPolicy } from "@ccr/agent";
import { ClefClient, type Transport } from "@ccr/clef";
import { afterEach, describe, expect, it } from "vitest";
import { parsePolicy, parseSeeds } from "./registry.ts";
import { compare, renderReport, summarize, verdict } from "./report.ts";
import { EPISODES_FILE, readEpisodes, runEpisodes } from "./run.ts";
import { bootstrapMean, bootstrapPairedDiff, mean, median, percentile } from "./stats.ts";

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
const meta = (runId: string) => ({
  runId,
  createdAt: "2026-10-14T00:00:00.000Z",
  episode,
  promptVersion: "test",
});

describe("stats", () => {
  it("computes mean, median and interpolated percentiles", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6, 10);
    expect(Number.isNaN(mean([]))).toBe(true);
  });

  it("bootstrap CI of a mean brackets the estimate and is reproducible", () => {
    const xs = Array.from({ length: 200 }, (_, i) => (i % 10) + 1);
    const a = bootstrapMean(xs, 2000, 7);
    const b = bootstrapMean(xs, 2000, 7);
    expect(a).toEqual(b);
    expect(a.estimate).toBeCloseTo(5.5, 10);
    expect(a.lo).toBeLessThan(5.5);
    expect(a.hi).toBeGreaterThan(5.5);
    expect(a.hi - a.lo).toBeLessThan(1);
  });

  it("paired CI excludes zero for a consistent improvement and includes it for noise", () => {
    const base = Array.from({ length: 100 }, (_, i) => (i * 7) % 11);
    const better = base.map((x) => x + 1 + (x % 2 === 0 ? 0 : 1));
    expect(bootstrapPairedDiff(better, base, 2000).lo).toBeGreaterThan(0);

    const noisy = base.map((x, i) => x + (i % 2 === 0 ? 2 : -2));
    const ci = bootstrapPairedDiff(noisy, base, 2000);
    expect(ci.lo).toBeLessThan(0);
    expect(ci.hi).toBeGreaterThan(0);
  });

  it("refuses unequal paired samples", () => {
    expect(() => bootstrapPairedDiff([1, 2], [1])).toThrow(RangeError);
  });
});

describe("registry", () => {
  const noClient = () => {
    throw new Error("no client for baselines");
  };

  it("parses seed specs", () => {
    expect(parseSeeds("1..3")).toEqual([1, 2, 3]);
    expect(parseSeeds("5")).toEqual([5]);
    expect(parseSeeds("1..2,9")).toEqual([1, 2, 9]);
    expect(() => parseSeeds("a")).toThrow();
    expect(() => parseSeeds("5..1")).toThrow();
  });

  it("builds baselines without a client and Clef policies with one", () => {
    expect(parsePolicy("always-forward", noClient).id).toBe("always-forward");
    expect(parsePolicy("random", noClient).id).toBe("random");
    expect(parsePolicy("lookahead", noClient).id).toBe("lookahead");
    expect(parsePolicy("lookahead-2", noClient).id).toBe("lookahead-2");
    const transport: Transport = { post: async () => ({ status: 200, json: null }) };
    const client = new ClefClient({ transport });
    expect(parsePolicy("clef:clef-flash:grid:critic", () => client).id).toBe(
      "clef:clef-flash:grid:critic:full",
    );
  });

  it("rejects unknown policies and malformed Clef ids", () => {
    expect(() => parsePolicy("nope", noClient)).toThrow(/Unknown policy/);
    expect(() => parsePolicy("clef:gpt:json:choice", noClient)).toThrow(/model/);
    expect(() => parsePolicy("clef:clef:xml:choice", noClient)).toThrow(/encoder/);
    expect(() => parsePolicy("clef:clef:json:vote", noClient)).toThrow(/strategy/);
    expect(() => parsePolicy("clef:clef:json:choice:huge", noClient)).toThrow(/manual/);
  });
});

describe("runEpisodes", () => {
  it("writes one record per (policy, seed) and a meta file", async () => {
    const runDir = tempDir();
    const summary = await runEpisodes(meta("t1"), {
      runDir,
      policies: [alwaysForward, randomPolicy],
      seeds: [1, 2, 3],
      concurrency: 2,
      episode,
      maxCalls: 100,
    });
    expect(summary).toMatchObject({ completed: 6, skipped: 0, failed: 0, stoppedBecause: "done" });
    const episodes = readEpisodes(runDir);
    expect(episodes).toHaveLength(6);
    expect(new Set(episodes.map((e) => e.policy))).toEqual(new Set(["always-forward", "random"]));
    expect(JSON.parse(readFileSync(join(runDir, "meta.json"), "utf8")).runId).toBe("t1");
  });

  it("resumes: a second invocation skips what is on disk and only plays the new seeds", async () => {
    const runDir = tempDir();
    const options = { runDir, policies: [alwaysForward], concurrency: 1, episode, maxCalls: 100 };
    await runEpisodes(meta("t2"), { ...options, seeds: [1, 2] });
    const second = await runEpisodes(meta("t2"), { ...options, seeds: [1, 2, 3, 4] });
    expect(second).toMatchObject({ completed: 2, skipped: 2 });
    expect(
      readEpisodes(runDir)
        .map((e) => e.seed)
        .sort(),
    ).toEqual([1, 2, 3, 4]);
  });

  it("tolerates a truncated last line left by an interrupted run", async () => {
    const runDir = tempDir();
    await runEpisodes(meta("t3"), {
      runDir,
      policies: [alwaysForward],
      seeds: [1],
      concurrency: 1,
      episode,
      maxCalls: 100,
    });
    appendFileSync(join(runDir, EPISODES_FILE), '{"policy":"always-forward","seed":2,"sco');
    expect(readEpisodes(runDir)).toHaveLength(1);
    const again = await runEpisodes(meta("t3"), {
      runDir,
      policies: [alwaysForward],
      seeds: [1, 2],
      concurrency: 1,
      episode,
      maxCalls: 100,
    });
    expect(again.completed).toBe(1);
    // The record written after the truncated line must be readable, not glued to the fragment.
    expect(
      readEpisodes(runDir)
        .map((e) => e.seed)
        .sort(),
    ).toEqual([1, 2]);
  });

  it("stops starting episodes once the API-call budget is spent", async () => {
    const runDir = tempDir();
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
    const summary = await runEpisodes(meta("t4"), {
      runDir,
      policies: [factory],
      seeds: Array.from({ length: 50 }, (_, i) => i + 1),
      concurrency: 1,
      episode,
      maxCalls: 15,
      client,
    });
    expect(summary.stoppedBecause).toBe("budget");
    expect(summary.completed).toBeLessThan(50);
    expect(client.stats().calls).toBeGreaterThanOrEqual(15);
    expect(client.stats().calls).toBeLessThan(15 + 40);
  });
});

describe("report", () => {
  it("summarises and compares policies on the same seeds", async () => {
    const runDir = tempDir();
    await runEpisodes(meta("t5"), {
      runDir,
      policies: [alwaysForward, randomPolicy],
      seeds: Array.from({ length: 80 }, (_, i) => i + 1),
      concurrency: 1,
      episode,
      maxCalls: 100,
    });
    const episodes = readEpisodes(runDir);
    const forward = episodes.filter((e) => e.policy === "always-forward");
    const summary = summarize("always-forward", forward);
    expect(summary.episodes).toBe(80);
    expect(summary.score.lo).toBeLessThanOrEqual(summary.score.mean);
    expect(summary.score.hi).toBeGreaterThanOrEqual(summary.score.mean);
    expect(Object.values(summary.deaths).reduce((a, b) => a + b, 0)).toBe(80);

    const byPolicy = new Map([
      ["always-forward", forward],
      ["random", episodes.filter((e) => e.policy === "random")],
    ]);
    const c = compare("random", "always-forward", byPolicy);
    expect(c?.pairedSeeds).toBe(80);
    expect(verdict(c as NonNullable<typeof c>)).toBe("worse");

    const text = renderReport("T", episodes, "always-forward");
    expect(text).toContain("| `always-forward` | 80 |");
    expect(text).toContain("Paired difference vs `always-forward`");
    expect(text).toContain("worse");
  });
});
