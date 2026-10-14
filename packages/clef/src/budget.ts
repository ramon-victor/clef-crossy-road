import type { ClefModel } from "./models.ts";

/**
 * Short, stable tag for a Cloudflare account (FNV-1a 64-bit of the account id, in hex). The free
 * allocation is per account, so the ledger is kept per account without writing ids into files.
 * Rust computes the same tag (src-tauri/src/lib.rs); both are tested against the same vectors.
 */
export function accountTag(accountId: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(accountId)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export interface SpendEntry {
  /** UTC calendar day, the unit Cloudflare resets the free allocation on. */
  day: string;
  /**
   * `accountTag` of the account that paid. An entry without it counts toward EVERY account, so
   * an old record can only ever make the guard stricter, never looser.
   */
  account?: string;
  /** ISO timestamp. */
  t: string;
  model: ClefModel;
  inputTokens: number;
  neurons: number;
  note?: string;
}

/**
 * A hard daily ceiling on what this project may spend on Workers AI, in neurons. The free tier is
 * 10,000 neurons per account per UTC day. The client asks `canSpend()` BEFORE every network call
 * and refuses to send when it is false, so exceeding the budget is impossible by accident.
 * Cache hits cost nothing and are always allowed.
 */
export interface SpendBudget {
  readonly dailyLimit: number;
  spentToday(): number | Promise<number>;
  canSpend(): boolean | Promise<boolean>;
  record(entry: Omit<SpendEntry, "day" | "t" | "account">): void | Promise<void>;
}

export const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

/** In-memory ledger. The file-backed one in `@ccr/clef/node` persists across runs. */
export class MemoryBudget implements SpendBudget {
  readonly dailyLimit: number;
  /** `accountTag` this ledger view belongs to; without it every entry counts (strictest). */
  readonly account: string | undefined;
  protected readonly entries: SpendEntry[] = [];
  private readonly clock: () => Date;

  constructor(dailyLimit: number, clock: () => Date = () => new Date(), account?: string) {
    if (!(dailyLimit >= 0)) throw new RangeError("dailyLimit must be >= 0");
    this.dailyLimit = dailyLimit;
    this.clock = clock;
    this.account = account;
  }

  spentToday(): number {
    const today = utcDay(this.clock());
    let total = 0;
    for (const e of this.entries) {
      if (e.day !== today) continue;
      const mine =
        e.account === undefined || this.account === undefined || e.account === this.account;
      if (mine) total += e.neurons;
    }
    return total;
  }

  canSpend(): boolean {
    return this.spentToday() < this.dailyLimit;
  }

  record(entry: Omit<SpendEntry, "day" | "t" | "account">): void {
    const now = this.clock();
    this.add({
      ...entry,
      day: utcDay(now),
      t: now.toISOString(),
      ...(this.account === undefined ? {} : { account: this.account }),
    });
  }

  protected add(entry: SpendEntry): void {
    this.entries.push(entry);
  }
}
