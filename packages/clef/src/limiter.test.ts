import { describe, expect, it } from "vitest";
import { AdaptiveLimiter } from "./limiter.ts";

describe("AdaptiveLimiter", () => {
  it("shrinks on rate limits, never below 1, and recovers after a streak of successes", () => {
    const limiter = new AdaptiveLimiter(8);
    limiter.onRateLimit();
    expect(limiter.currentLimit).toBe(4);
    for (let i = 0; i < 3; i++) limiter.onRateLimit();
    expect(limiter.currentLimit).toBe(1);
    for (let i = 0; i < 20; i++) limiter.onSuccess();
    expect(limiter.currentLimit).toBe(2);
  });

  it("never recovers past the maximum it was given", () => {
    const limiter = new AdaptiveLimiter(2, 3);
    for (let i = 0; i < 100; i++) limiter.onSuccess();
    expect(limiter.currentLimit).toBe(3);
  });

  it("rejects a concurrency below 1", () => {
    expect(() => new AdaptiveLimiter(0)).toThrow(RangeError);
  });

  it("queues callers beyond the limit and lets them in as slots are released", async () => {
    const limiter = new AdaptiveLimiter(2);
    const first = await limiter.acquire();
    const second = await limiter.acquire();
    let thirdIn = false;
    const third = limiter.acquire().then((release) => {
      thirdIn = true;
      return release;
    });
    await Promise.resolve();
    expect([thirdIn, limiter.inFlight]).toEqual([false, 2]);

    first();
    const releaseThird = await third;
    expect([thirdIn, limiter.inFlight]).toEqual([true, 2]);

    first(); // releasing the same slot twice must not free a second one
    expect(limiter.inFlight).toBe(2);
    second();
    releaseThird();
    expect(limiter.inFlight).toBe(0);
  });
});
