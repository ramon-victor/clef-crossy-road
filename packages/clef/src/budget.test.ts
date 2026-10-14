import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { accountTag, MemoryBudget, utcDay } from "./budget.ts";
import { MemoryCache } from "./cache.ts";
import { ClefClient } from "./client.ts";
import { FileBudget } from "./node.ts";
import type { Transport } from "./transport.ts";
import type { ClefRequest } from "./types.ts";

const body = (tokens: number) => ({
  result: {
    answers: { move: { type: "choice", choice: "hop_forward", probabilities: { hop_forward: 1 } } },
    usage: { input_tokens: tokens, output_tokens: 0 },
  },
});

const request = (i = 0): ClefRequest => ({
  model: "clef-flash",
  state: { i },
  questions: {
    move: { type: "choice", instructions: "Pick.", criteria: { hop_forward: "forward" } },
  },
});

function countingTransport(tokens: number) {
  let calls = 0;
  const transport: Transport = {
    async post() {
      calls++;
      return { status: 200, json: body(tokens) };
    },
  };
  return { transport, calls: () => calls };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("MemoryBudget", () => {
  it("accumulates spending per UTC day and rolls over at midnight UTC", () => {
    let now = new Date("2026-10-14T23:30:00Z");
    const budget = new MemoryBudget(100, () => now);
    budget.record({ model: "clef-flash", inputTokens: 1, neurons: 60 });
    expect(budget.spentToday()).toBe(60);
    expect(budget.canSpend()).toBe(true);
    budget.record({ model: "clef-flash", inputTokens: 1, neurons: 50 });
    expect(budget.canSpend()).toBe(false);

    now = new Date("2026-10-15T00:00:01Z");
    expect(budget.spentToday()).toBe(0);
    expect(budget.canSpend()).toBe(true);
    expect(utcDay(now)).toBe("2026-10-15");
  });

  it("a zero budget never allows a call", () => {
    expect(new MemoryBudget(0).canSpend()).toBe(false);
  });
});

describe("per-account ledger", () => {
  const noon = () => new Date("2026-10-14T12:00:00Z");

  it("accountTag is FNV-1a 64 and matches the published test vectors (Rust is tested on the same ones)", () => {
    expect(accountTag("")).toBe("cbf29ce484222325");
    expect(accountTag("a")).toBe("af63dc4c8601ec8c");
    expect(accountTag("foobar")).toBe("85944171f73967e8");
  });

  it("spending on one account does not count toward another one's free tier", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccr-budget-"));
    dirs.push(dir);
    const path = join(dir, "spend.ndjson");
    const old = new FileBudget(path, 10_000, noon, "old-account");
    old.record({ model: "clef-flash", inputTokens: 1, neurons: 26_347 });
    expect(old.canSpend()).toBe(false);

    const fresh = new FileBudget(path, 10_000, noon, "new-account");
    expect(fresh.spentToday()).toBe(0);
    expect(fresh.canSpend()).toBe(true);
    fresh.record({ model: "clef-flash", inputTokens: 1, neurons: 400 });

    // Each view still sees only its own account, also after reloading from disk.
    expect(new FileBudget(path, 10_000, noon, "old-account").spentToday()).toBe(26_347);
    expect(new FileBudget(path, 10_000, noon, "new-account").spentToday()).toBe(400);
  });

  it("sees spending written by another process after it was constructed", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccr-budget-"));
    dirs.push(dir);
    const path = join(dir, "spend.ndjson");
    const mine = new FileBudget(path, 10_000, noon, "acct");
    const other = new FileBudget(path, 10_000, noon, "acct");
    expect(mine.canSpend()).toBe(true);
    other.record({ model: "clef-flash", inputTokens: 1, neurons: 10_000 });
    expect(mine.spentToday()).toBe(10_000);
    expect(mine.canSpend()).toBe(false);
    // Its own record must not hide what the other process wrote.
    const third = new FileBudget(path, 20_000, noon, "acct");
    third.record({ model: "clef-flash", inputTokens: 1, neurons: 5 });
    expect(mine.spentToday()).toBe(10_005);
  });

  it("a failing ledger write after a paid call does not trigger a second paid call", async () => {
    const { transport, calls } = countingTransport(1000);
    const budget = new MemoryBudget(10_000, noon);
    budget.record = () => {
      throw new Error("disk full");
    };
    const client = new ClefClient({
      transport,
      budget,
      cache: new MemoryCache(),
      sleep: async () => {},
    });
    await expect(client.run(request())).rejects.toThrow("disk full");
    expect(calls()).toBe(1);
  });

  it("an untagged (legacy) entry counts toward every account, so it can only make the guard stricter", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccr-budget-"));
    dirs.push(dir);
    const path = join(dir, "spend.ndjson");
    appendFileSync(
      path,
      `${JSON.stringify({ day: "2026-10-14", t: "x", model: "clef", inputTokens: 1, neurons: 9_999 })}\n`,
    );
    expect(new FileBudget(path, 10_000, noon, "any-account").spentToday()).toBe(9_999);
    expect(new FileBudget(path, 10_000, noon).spentToday()).toBe(9_999); // no account: everything counts
  });

  it("never writes the raw account id into the ledger", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccr-budget-"));
    dirs.push(dir);
    const path = join(dir, "spend.ndjson");
    new FileBudget(path, 10_000, noon, "0123456789abcdef0123456789abcdef").record({
      model: "clef-flash",
      inputTokens: 1,
      neurons: 1,
    });
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain("0123456789abcdef0123456789abcdef");
    expect(text).toContain(accountTag("0123456789abcdef0123456789abcdef"));
  });
});

describe("ClefClient with a budget", () => {
  it("refuses to send once the daily limit is reached, and says nothing was sent", async () => {
    const { transport, calls } = countingTransport(4_000_000); // ~13.8k neurons per call: one call exhausts it
    const budget = new MemoryBudget(10_000);
    const client = new ClefClient({ transport, budget, sleep: async () => {} });

    await client.run(request(1));
    expect(budget.canSpend()).toBe(false);

    const error = await client.run(request(2)).catch((e) => e);
    expect(error.kind).toBe("quota");
    expect(error.fatal).toBe(true);
    expect(error.message).toContain("Nothing was sent");
    expect(calls()).toBe(1);
  });

  it("still serves cache hits when the budget is exhausted, for free", async () => {
    const { transport, calls } = countingTransport(4_000_000);
    const budget = new MemoryBudget(10_000);
    const client = new ClefClient({ transport, budget, cache: new MemoryCache() });
    await client.run(request(1));
    expect(budget.canSpend()).toBe(false);

    const again = await client.run(request(1));
    expect(again.cached).toBe(true);
    expect(calls()).toBe(1);
    expect(budget.spentToday()).toBeCloseTo(13_818, 0);
  });

  it("does not charge for calls that failed", async () => {
    const budget = new MemoryBudget(10_000);
    const transport: Transport = { post: async () => ({ status: 500, json: null }) };
    const client = new ClefClient({
      transport,
      budget,
      maxAttempts: 2,
      sleep: async () => {},
    });
    await client.run(request()).catch(() => {});
    expect(budget.spentToday()).toBe(0);
  });

  it("stays under the ceiling by a bounded margin when many requests race", async () => {
    // Each call costs ~345 neurons (100k tokens). A limit of 1,000 allows 3 sequential calls plus
    // at most the calls already in flight when the limit is crossed.
    const { transport, calls } = countingTransport(100_000);
    const budget = new MemoryBudget(1000);
    const client = new ClefClient({ transport, budget, concurrency: 2, sleep: async () => {} });
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => client.run(request(i))),
    );
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(calls());
    expect(calls()).toBeLessThanOrEqual(3 + 2);
    expect(calls()).toBeGreaterThanOrEqual(3);
  });
});

describe("FileBudget", () => {
  it("persists spending across instances and ignores a truncated last line", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccr-budget-"));
    dirs.push(dir);
    const path = join(dir, "spend.ndjson");
    const clock = () => new Date("2026-10-14T12:00:00Z");

    const first = new FileBudget(path, 1000, clock);
    first.record({ model: "clef-flash", inputTokens: 10, neurons: 400 });
    first.record({ model: "clef", inputTokens: 10, neurons: 300 });

    appendFileSync(path, '{"day":"2026-10-14","t":"x","mod');
    const second = new FileBudget(path, 1000, clock);
    expect(second.spentToday()).toBe(700);
    expect(second.canSpend()).toBe(true);
    second.record({ model: "clef-flash", inputTokens: 10, neurons: 400 });
    expect(new FileBudget(path, 1000, clock).canSpend()).toBe(false);

    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it("only counts entries from today", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccr-budget-"));
    dirs.push(dir);
    const path = join(dir, "spend.ndjson");
    const yesterday = new FileBudget(path, 500, () => new Date("2026-10-13T20:00:00Z"));
    yesterday.record({ model: "clef-flash", inputTokens: 1, neurons: 9999 });
    const today = new FileBudget(path, 500, () => new Date("2026-10-14T01:00:00Z"));
    expect(today.spentToday()).toBe(0);
    expect(today.canSpend()).toBe(true);
  });
});
