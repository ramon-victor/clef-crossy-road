import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { accountTag, MemoryBudget, type SpendEntry } from "./budget.ts";
import type { CachedEntry, DecisionCache } from "./cache.ts";
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

/**
 * If a previous process died mid-write, the file ends without a newline. Terminate that partial
 * line, otherwise the next appended record would be glued to it and become unreadable. For the
 * spend ledger that would silently under-count what was spent.
 */
function terminatePartialLine(path: string, text: string): void {
  if (text.length > 0 && !text.endsWith("\n")) appendFileSync(path, "\n");
}

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
    if (existsSync(path)) terminatePartialLine(path, readFileSync(path, "utf8"));
    this.reload();
  }

  /**
   * Another process (the desktop app, a second bench run) may have spent since this one started.
   * The ledger is re-read whenever its size changed, so the ceiling holds across processes and not
   * only inside this one.
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
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry: unknown = JSON.parse(line);
        if (typeof entry === "object" && entry !== null) this.entries.push(entry as SpendEntry);
      } catch {
        // Ignore a partially written last line.
      }
    }
    this.knownSize = size;
  }

  protected override add(entry: SpendEntry): void {
    this.reload(); // pick up what others wrote before this record, so none of it is lost from view
    super.add(entry);
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
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
    if (existsSync(path)) {
      const text = readFileSync(path, "utf8");
      terminatePartialLine(path, text);
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const { k, v } = JSON.parse(line) as { k: string; v: CachedEntry };
          this.map.set(k, v);
        } catch {
          // A partially written last line (crash) is ignored; the call is simply repeated.
        }
      }
    }
  }

  get(key: string): CachedEntry | undefined {
    return this.map.get(key);
  }

  set(key: string, value: CachedEntry): void {
    this.map.set(key, value);
    appendFileSync(this.path, `${JSON.stringify({ k: key, v: value })}\n`);
  }

  get size(): number {
    return this.map.size;
  }
}
