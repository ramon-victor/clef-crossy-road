import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { accountTag, MemoryBudget, type SpendEntry } from "./budget.ts";
import type { CachedEntry, DecisionCache } from "./cache.ts";
import { appendNdjson, endPartialLine, readNdjson } from "./ndjson.ts";
import type { Transport, TransportRequest, TransportResponse } from "./transport.ts";

export interface NodeTransportOptions {
  /** Defaults to process.env.CF_API_TOKEN (load it with `node --env-file=.env`). */
  token?: string;
  /** Defaults to process.env.CF_ACCOUNT_ID. */
  accountId?: string;
  fetchImpl?: typeof fetch;
}

/**
 * REST transport for scripts running in Node. The token stays inside this closure: it is never
 * logged, never returned and never placed in an error message.
 */
export function createNodeTransport(options: NodeTransportOptions = {}): Transport {
  const token = options.token ?? process.env.CF_API_TOKEN;
  const accountId = options.accountId ?? process.env.CF_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new Error(
      "CF_API_TOKEN and CF_ACCOUNT_ID are required. Run with `node --env-file=.env ...` (see .env.example).",
    );
  }
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async post(request: TransportRequest): Promise<TransportResponse> {
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/cloudflare/${request.model}`;
      const init: RequestInit = {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
      };
      if (request.signal) init.signal = request.signal;
      const response = await doFetch(url, init);

      let json: unknown = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      return {
        status: response.status,
        json,
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterMs: retryAfter * 1000 }
          : {}),
      };
    },
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Daily spending ledger persisted as NDJSON (one `SpendEntry` per paid call). Every process that
 * talks to Workers AI for this project must use the same file, so the ceiling holds across runs.
 */
export class FileBudget extends MemoryBudget {
  private readonly path: string;
  /** Size of the ledger file when it was last read; a different size means another process wrote. */
  private knownSize = -1;

  /**
   * `accountId` (the raw Cloudflare account id, or undefined) selects whose spending this view counts.
   * It is converted to a tag; the id itself is never written to the ledger.
   */
  constructor(path: string, dailyLimit: number, clock?: () => Date, accountId?: string) {
    super(dailyLimit, clock, accountId ? accountTag(accountId) : undefined);
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    endPartialLine(path);
    this.reload();
  }

  /**
   * Another process (the desktop app, a second bench run) may have spent since this one started, so
   * the ledger is re-read whenever its size changed. That makes the ceiling hold across processes.
   */
  override spentToday(): number {
    this.reload();
    return super.spentToday();
  }

  private reload(): void {
    if (!existsSync(this.path)) return;
    const size = statSync(this.path).size;
    if (size === this.knownSize) return;
    this.entries.length = 0;
    for (const entry of readNdjson(this.path)) {
      if (isObject(entry)) this.entries.push(entry as unknown as SpendEntry);
    }
    this.knownSize = size;
  }

  protected override add(entry: SpendEntry): void {
    this.reload(); // pick up what others wrote first, so none of it drops out of view
    super.add(entry);
    appendNdjson(this.path, entry);
    this.knownSize = statSync(this.path).size;
  }
}

/**
 * Append-only NDJSON cache on disk, loaded into memory on construction. Each line is
 * `{"k": key, "v": entry}`. Safe to share between runs: later lines win.
 */
export class FileCache implements DecisionCache {
  private readonly map = new Map<string, CachedEntry>();
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    endPartialLine(path);
    for (const line of readNdjson(path)) {
      if (isObject(line) && typeof line.k === "string") {
        this.map.set(line.k, line.v as CachedEntry);
      }
    }
  }

  get(key: string): CachedEntry | undefined {
    return this.map.get(key);
  }

  set(key: string, value: CachedEntry): void {
    this.map.set(key, value);
    appendNdjson(this.path, { k: key, v: value });
  }

  get size(): number {
    return this.map.size;
  }
}

export { appendNdjson, endPartialLine, readNdjson };
