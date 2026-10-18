import {
  type CachedEntry,
  ClefClient,
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

/** Sends requests through the native side, which holds the credentials. */
class BridgeTransport implements Transport {
  private readonly bridge: Bridge;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  async post(request: TransportRequest): Promise<TransportResponse> {
    return this.bridge.run(request.model, request.body);
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
  private readonly bridge: Bridge;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  async spentToday(): Promise<number> {
    return (await this.bridge.budget()).spent;
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
