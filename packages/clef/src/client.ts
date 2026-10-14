import type { SpendBudget } from "./budget.ts";
import type { CachedEntry, DecisionCache } from "./cache.ts";
import { ClefError } from "./errors.ts";
import { hashString } from "./hash.ts";
import { AdaptiveLimiter } from "./limiter.ts";
import { neuronsForTokens, usdForTokens } from "./models.ts";
import { errorMessages, parseResult } from "./schema.ts";
import type { Transport, TransportResponse } from "./transport.ts";
import type { ClefRequest, ClefResult, ClefStats } from "./types.ts";

export interface ClefClientOptions {
  transport: Transport;
  cache?: DecisionCache;
  /** Daily spending ceiling. Checked before every network call; strongly recommended. */
  budget?: SpendBudget;
  /** Initial concurrent requests. Halves on 429 and recovers slowly. Default 4. */
  concurrency?: number;
  /** Upper bound the limiter may recover to. Defaults to `concurrency`. */
  maxConcurrency?: number;
  /** Total attempts per request, first try included. Default 4. */
  maxAttempts?: number;
  /** Per-attempt timeout. Default 10 s. */
  timeoutMs?: number;
  /** First backoff step. Default 500 ms, doubling, with jitter. */
  backoffMs?: number;
  // Injectable for tests.
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const QUOTA_PATTERN = /daily free allocation|used up your daily|neurons? (limit|quota)/i;

/**
 * Observed 2026-10-14 as HTTP 429 with code 3040 in roughly 1 of 30 calls during bursts, even at
 * 4 concurrent requests, while 16 parallel requests later all succeeded. It is transient service
 * capacity, not the account's rate limit, so it is retried but must not shrink the concurrency.
 */
const CAPACITY_PATTERN = /capacity temporarily exceeded/i;

export class ClefClient {
  private readonly transport: Transport;
  private readonly cache: DecisionCache | undefined;
  private readonly budget: SpendBudget | undefined;
  private readonly limiter: AdaptiveLimiter;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly backoffMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly counters: Omit<ClefStats, "latenciesMs"> = {
    calls: 0,
    cacheHits: 0,
    retries: 0,
    failures: 0,
    inputTokens: 0,
    neurons: 0,
    usd: 0,
  };
  private readonly latencies: number[] = [];

  constructor(options: ClefClientOptions) {
    this.transport = options.transport;
    this.cache = options.cache;
    this.budget = options.budget;
    const concurrency = options.concurrency ?? 4;
    this.limiter = new AdaptiveLimiter(concurrency, options.maxConcurrency ?? concurrency);
    this.maxAttempts = options.maxAttempts ?? 4;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.backoffMs = options.backoffMs ?? 500;
    this.now = options.now ?? (() => performance.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  stats(): ClefStats {
    return { ...this.counters, latenciesMs: [...this.latencies] };
  }

  get concurrencyLimit(): number {
    return this.limiter.currentLimit;
  }

  /** Neurons spent today (UTC) according to the budget ledger, if one is configured. */
  async spentTodayNeurons(): Promise<number | undefined> {
    return this.budget ? await this.budget.spentToday() : undefined;
  }

  async run(request: ClefRequest): Promise<ClefResult> {
    const key = this.cacheKey(request);
    const hit = await this.cache?.get(key);
    if (hit) {
      this.counters.cacheHits++;
      return {
        model: hit.model,
        answers: hit.answers,
        usage: hit.usage,
        latencyMs: hit.latencyMs,
        attempts: 0,
        cached: true,
        neurons: 0,
      };
    }

    let lastError: ClefError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const release = await this.limiter.acquire();
      // Checked after waiting for a slot, right before sending: nothing leaves this process once
      // the day's budget is gone.
      if (this.budget && !(await this.budget.canSpend())) {
        release();
        const spent = Math.round(await this.budget.spentToday());
        throw new ClefError(
          "quota",
          `Local daily budget reached: ${spent} of ${this.budget.dailyLimit} neurons used today (UTC). Nothing was sent.`,
        );
      }
      const startedAt = this.now();
      try {
        const { answers, usage } = await this.attempt(request);
        const latencyMs = this.now() - startedAt;
        release();
        this.limiter.onSuccess();

        const neurons = neuronsForTokens(request.model, usage.inputTokens);
        await this.budget?.record({
          model: request.model,
          inputTokens: usage.inputTokens,
          neurons,
        });
        this.counters.calls++;
        this.counters.inputTokens += usage.inputTokens;
        this.counters.neurons += neurons;
        this.counters.usd += usdForTokens(request.model, usage.inputTokens);
        this.latencies.push(latencyMs);

        const entry: CachedEntry = { model: request.model, answers, usage, latencyMs };
        await this.cache?.set(key, entry);
        return { ...entry, attempts: attempt, cached: false, neurons };
      } catch (error) {
        release();
        const err = error instanceof ClefError ? error : toNetworkError(error);
        lastError = err;
        if (err.kind === "rate_limit") this.limiter.onRateLimit();
        if (!err.retryable || attempt === this.maxAttempts) break;
        this.counters.retries++;
        await this.sleep(this.delayFor(attempt, err));
      }
    }
    this.counters.failures++;
    throw lastError ?? new ClefError("network", "request failed");
  }

  private async attempt(request: ClefRequest) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: TransportResponse;
    try {
      response = await this.transport.post({
        model: request.model,
        body: {
          model: request.model,
          state: request.state,
          questions: request.questions,
          ...(request.images ? { images: request.images } : {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ClefError("timeout", `No response within ${this.timeoutMs} ms`);
      }
      throw toNetworkError(error);
    } finally {
      clearTimeout(timer);
    }

    const { status, json } = response;
    const message = errorMessages(json);

    if (status >= 200 && status < 300) {
      const success = (json as { success?: unknown } | null)?.success;
      if (success === false) throw classifyFailure(status, message || "success: false", response);
      return parseResult(json);
    }
    throw classifyFailure(status, message, response);
  }

  private delayFor(attempt: number, error: ClefError): number {
    const exponential = this.backoffMs * 2 ** (attempt - 1);
    const jitter = exponential * 0.25 * this.random();
    const hinted = (error as ClefErrorWithRetryAfter).retryAfterMs ?? 0;
    return Math.max(hinted, exponential + jitter);
  }

  private cacheKey(request: ClefRequest): string {
    return hashString(
      JSON.stringify([
        request.model,
        request.state,
        request.questions,
        request.images ? request.images.map((i) => hashString(i)) : null,
        request.cacheTag ?? "",
      ]),
    );
  }
}

type ClefErrorWithRetryAfter = ClefError & { retryAfterMs?: number };

function classifyFailure(status: number, message: string, response: TransportResponse): ClefError {
  const text = message || `HTTP ${status}`;
  let error: ClefError;
  if (status === 401 || status === 403) error = new ClefError("auth", text, status);
  else if (QUOTA_PATTERN.test(text)) error = new ClefError("quota", text, status);
  else if (CAPACITY_PATTERN.test(text)) error = new ClefError("capacity", text, status);
  else if (status === 429) error = new ClefError("rate_limit", text, status);
  else if (status >= 500) error = new ClefError("server", text, status);
  else if (status >= 400) error = new ClefError("bad_request", text, status);
  else error = new ClefError("server", text, status);
  if (response.retryAfterMs !== undefined) {
    (error as ClefErrorWithRetryAfter).retryAfterMs = response.retryAfterMs;
  }
  return error;
}

function toNetworkError(error: unknown): ClefError {
  const reason = error instanceof Error ? error.message : String(error);
  return new ClefError("network", reason.slice(0, 300));
}
