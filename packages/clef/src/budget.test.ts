import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { accountTag, budgetRefusal, isBudgetRefusal, MemoryBudget, utcDay } from "./budget.ts";
import { MemoryCache } from "./cache.ts";
import { ClefClient } from "./client.ts";
import { countingTransport, sampleRequest } from "./fixtures.testing.ts";
import { FileBudget } from "./node.ts";
import { useTempDirs } from "./temp.testing.ts";
import type { Transport } from "./transport.ts";

const tempDir = useTempDirs();
const ledger = () => join(tempDir(), "spend.ndjson");
const noon = () => new Date("2026-10-14T12:00:00Z");
const spend = (neurons: number) => ({ model: "clef-flash" as const, inputTokens: 1, neurons });

describe("MemoryBudget", () => {
  it("accumulates spending per UTC day and rolls over at midnight UTC", () => {
    let now = new Date("2026-10-14T23:30:00Z");
    const budget = new MemoryBudget(100, () => now);
    budget.record(spend(60));
    expect(budget.spentToday()).toBe(60);
    expect(budget.canSpend()).toBe(true);
    budget.record(spend(50));
    expect(budget.canSpend()).toBe(false);

    now = new Date("2026-10-15T00:00:01Z");
    expect(budget.spentToday()).toBe(0);
    expect(budget.canSpend()).toBe(true);
    expect(utcDay(now)).toBe("2026-10-15");
  });

  it("a zero budget never allows a call", () => {
    expect(new MemoryBudget(0).canSpend()).toBe(false);
  });

  it("words the refusal so the UI can recognise it", () => {
    const message = budgetRefusal(26_347.4, 10_000);
    expect(message).toBe(
      "Local daily budget reached: 26347 of 10000 neurons used today (UTC). Nothing was sent.",
    );
    expect(isBudgetRefusal(message)).toBe(true);
    expect(isBudgetRefusal("network error: timeout")).toBe(false);
  });
});

describe("FileBudget", () => {
  it("persists spending across instances and survives a line cut short by a crash", () => {
    const path = ledger();
    const first = new FileBudget(path, 1000, noon);
    first.record(spend(400));
    first.record(spend(300));

    appendFileSync(path, '{"day":"2026-10-14","t":"x","mod');
    const second = new FileBudget(path, 1000, noon);
    expect(second.spentToday()).toBe(700);
    second.record(spend(400));
    expect(new FileBudget(path, 1000, noon).canSpend()).toBe(false);

    // The new record starts its own line instead of being glued to the fragment.
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines.at(-1) as string)).toMatchObject({ neurons: 400 });
  });

  it("only counts entries from today", () => {
    const path = ledger();
    new FileBudget(path, 500, () => new Date("2026-10-13T20:00:00Z")).record(spend(9999));
    const today = new FileBudget(path, 500, () => new Date("2026-10-14T01:00:00Z"));
    expect(today.spentToday()).toBe(0);
    expect(today.canSpend()).toBe(true);
  });

  it("sees spending written by another process after it was constructed", () => {
    const path = ledger();
    const mine = new FileBudget(path, 10_000, noon, "acct");
    const other = new FileBudget(path, 10_000, noon, "acct");
    expect(mine.canSpend()).toBe(true);
    other.record(spend(10_000));
    expect(mine.spentToday()).toBe(10_000);
    expect(mine.canSpend()).toBe(false);

    // Its own record must not hide what the other process wrote.
    new FileBudget(path, 20_000, noon, "acct").record(spend(5));
    expect(mine.spentToday()).toBe(10_005);
  });
});

describe("per-account ledger", () => {
  it("accountTag is FNV-1a 64 and matches the published test vectors (Rust is tested on the same ones)", () => {
    expect(accountTag("")).toBe("cbf29ce484222325");
    expect(accountTag("a")).toBe("af63dc4c8601ec8c");
    expect(accountTag("foobar")).toBe("85944171f73967e8");
  });

  it("spending on one account does not count toward another one's free tier", () => {
    const path = ledger();
    const old = new FileBudget(path, 10_000, noon, "old-account");
    old.record(spend(26_347));
    expect(old.canSpend()).toBe(false);

    const fresh = new FileBudget(path, 10_000, noon, "new-account");
    expect(fresh.spentToday()).toBe(0);
    expect(fresh.canSpend()).toBe(true);
    fresh.record(spend(400));

    // Each view still sees only its own account, also after reloading from disk.
    expect(new FileBudget(path, 10_000, noon, "old-account").spentToday()).toBe(26_347);
    expect(new FileBudget(path, 10_000, noon, "new-account").spentToday()).toBe(400);
  });

  it("an untagged (legacy) entry counts toward every account, so it can only make the guard stricter", () => {
    const path = ledger();
    const entry = { day: "2026-10-14", t: "x", model: "clef", inputTokens: 1, neurons: 9_999 };
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
    expect(new FileBudget(path, 10_000, noon, "any-account").spentToday()).toBe(9_999);
    expect(new FileBudget(path, 10_000, noon).spentToday()).toBe(9_999); // no account: everything counts
  });

  it("never writes the raw account id into the ledger", () => {
    const path = ledger();
    const account = "0123456789abcdef0123456789abcdef";
    new FileBudget(path, 10_000, noon, account).record(spend(1));
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain(account);
    expect(text).toContain(accountTag(account));
  });
});

describe("ClefClient with a budget", () => {
  const quiet = { sleep: async () => {} };

  it("refuses to send once the daily limit is reached, and says nothing was sent", async () => {
    const { transport, calls } = countingTransport(4_000_000); // ~13.8k neurons per call: one call exhausts it
    const budget = new MemoryBudget(10_000);
    const client = new ClefClient({ transport, budget, ...quiet });

    await client.run(sampleRequest(1));
    expect(budget.canSpend()).toBe(false);

    const error = await client.run(sampleRequest(2)).catch((e) => e);
    expect(error).toMatchObject({ kind: "quota", fatal: true });
    expect(isBudgetRefusal(error.message)).toBe(true);
    expect(calls()).toBe(1);
  });

  it("still serves cache hits when the budget is exhausted, for free", async () => {
    const { transport, calls } = countingTransport(4_000_000);
    const budget = new MemoryBudget(10_000);
    const client = new ClefClient({ transport, budget, cache: new MemoryCache() });
    await client.run(sampleRequest(1));
    expect(budget.canSpend()).toBe(false);

    const again = await client.run(sampleRequest(1));
    expect(again.cached).toBe(true);
    expect(calls()).toBe(1);
    expect(budget.spentToday()).toBeCloseTo(13_818, 0);
  });

  it("does not charge for calls that failed", async () => {
    const budget = new MemoryBudget(10_000);
    const transport: Transport = { post: async () => ({ status: 500, json: null }) };
    const client = new ClefClient({ transport, budget, maxAttempts: 2, ...quiet });
    await client.run(sampleRequest()).catch(() => {});
    expect(budget.spentToday()).toBe(0);
  });

  it("stays under the ceiling by a bounded margin when many requests race", async () => {
    // Each call costs ~345 neurons (100k tokens). A limit of 1,000 allows 3 sequential calls plus
    // at most the calls already in flight when the limit is crossed.
    const { transport, calls } = countingTransport(100_000);
    const budget = new MemoryBudget(1000);
    const client = new ClefClient({ transport, budget, concurrency: 2, ...quiet });
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => client.run(sampleRequest(i))),
    );
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(calls());
    expect(calls()).toBeLessThanOrEqual(3 + 2);
    expect(calls()).toBeGreaterThanOrEqual(3);
  });

  it("a failing ledger write after a paid call does not trigger a second paid call", async () => {
    const { transport, calls } = countingTransport(1000);
    const budget = new MemoryBudget(10_000, noon);
    budget.record = () => {
      throw new Error("disk full");
    };
    const client = new ClefClient({ transport, budget, cache: new MemoryCache(), ...quiet });
    await expect(client.run(sampleRequest())).rejects.toThrow("disk full");
    expect(calls()).toBe(1);
  });

  it("gives its concurrency slot back when the budget check itself fails", async () => {
    const { transport } = countingTransport(1000);
    const budget = new MemoryBudget(10_000);
    let failing = true;
    budget.canSpend = () => {
      if (failing) throw new Error("ledger unreadable");
      return true;
    };
    const client = new ClefClient({ transport, budget, concurrency: 1, ...quiet });
    await expect(client.run(sampleRequest(1))).rejects.toThrow("ledger unreadable");
    failing = false;
    // With the slot leaked, this second request would wait forever on a limit of 1.
    await expect(client.run(sampleRequest(2))).resolves.toMatchObject({ cached: false });
  });
});
