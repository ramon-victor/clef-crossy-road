import {
  type CachedEntry,
  ClefClient,
  ClefError,
  type DecisionCache,
  FREE_NEURONS_PER_DAY,
  type SpendBudget,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from "@ccr/clef";
import { httpBridge } from "./http.ts";
import { isTauri, tauriBridge } from "./tauri.ts";
import type { Bridge } from "./types.ts";

export const createBridge = (): Bridge => (isTauri() ? tauriBridge : httpBridge);

const BUDGET_MESSAGE = /Local daily budget reached/;
/** Missing credentials never fix themselves, so they must not be retried like a network blip. */
const CREDENTIALS_MESSAGE = /CF_API_TOKEN|CF_ACCOUNT_ID/;

/** Sends requests through the native side, which holds the credentials. */
class BridgeTransport implements Transport {
  private readonly bridge: Bridge;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  async post(request: TransportRequest): Promise<TransportResponse> {
    try {
      return await this.bridge.run(request.model, request.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (BUDGET_MESSAGE.test(message)) throw new ClefError("quota", message);
      if (CREDENTIALS_MESSAGE.test(message)) throw new ClefError("auth", message);
      throw new Error(message);
    }
  }
}

class BridgeCache implements DecisionCache {
  private readonly bridge: Bridge;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  async get(key: string): Promise<CachedEntry | undefined> {
    return (await this.bridge.cacheGet(key)) ?? undefined;
  }

  async set(key: string, value: CachedEntry): Promise<void> {
    await this.bridge.cachePut(key, value);
  }
}

/**
 * Reads the authoritative ledger on the native side before each call. The native side enforces the
 * same ceiling itself and records the spend, so `record` has nothing to do here.
 */
class BridgeBudget implements SpendBudget {
  readonly dailyLimit = FREE_NEURONS_PER_DAY;
  private lastSpent = 0;
  private readonly bridge: Bridge;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  async spentToday(): Promise<number> {
    this.lastSpent = (await this.bridge.budget()).spent;
    return this.lastSpent;
  }

  async canSpend(): Promise<boolean> {
    return (await this.spentToday()) < this.dailyLimit;
  }

  record(): void {}
}

export function createClefClient(bridge: Bridge): ClefClient {
  return new ClefClient({
    transport: new BridgeTransport(bridge),
    cache: new BridgeCache(bridge),
    budget: new BridgeBudget(bridge),
    concurrency: 2,
  });
}
