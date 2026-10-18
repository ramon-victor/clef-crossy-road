import { describe, expect, it } from "vitest";
import { MemoryCache } from "./cache.ts";
import { ClefClient } from "./client.ts";
import { ClefError } from "./errors.ts";
import { choiceBody, sampleRequest, scripted } from "./fixtures.testing.ts";
import type { Transport } from "./transport.ts";

const request = sampleRequest();

const fast = {
  sleep: async () => {},
  random: () => 0,
  now: (() => {
    let t = 0;
    return () => (t += 10);
  })(),
};

describe("ClefClient", () => {
  it.each(["auth", "quota", "bad_request"] as const)(
    "preserves a transport's %s classification and does not retry it",
    async (kind) => {
      let calls = 0;
      const error = new ClefError(kind, "Classified by the local bridge");
      const client = new ClefClient({
        transport: {
          post: async () => {
            calls++;
            throw error;
          },
        },
        ...fast,
      });
      await expect(client.run(request)).rejects.toBe(error);
      expect(calls).toBe(1);
      expect(client.stats().retries).toBe(0);
    },
  );

  it("returns the parsed choice, usage and cost for a successful call", async () => {
    const { transport, seen } = scripted([{ status: 200, json: choiceBody() }]);
    const client = new ClefClient({ transport, ...fast });
    const result = await client.run(request);

    expect(result.answers.move).toMatchObject({ type: "choice", choice: "hop_forward" });
    expect(result.usage).toEqual({ inputTokens: 444, outputTokens: 0 });
    expect(result.cached).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.neurons).toBeCloseTo((444 / 1e6) * 3455, 3);
    expect(seen[0]?.body).toMatchObject({ model: "clef-flash", questions: request.questions });
    expect(client.stats()).toMatchObject({ calls: 1, cacheHits: 0, retries: 0, inputTokens: 444 });
  });

  it("accepts the Worker-binding shape (no result envelope)", async () => {
    const payload = choiceBody().result;
    const { transport } = scripted([{ status: 200, json: payload }]);
    const result = await new ClefClient({ transport, ...fast }).run(request);
    expect(result.answers.move).toMatchObject({ choice: "hop_forward" });
  });

  it("retries rate limits and server errors, then succeeds", async () => {
    const { transport, calls } = scripted([
      { status: 429, json: { errors: [{ message: "slow down" }] } },
      { status: 503, json: null },
      { status: 200, json: choiceBody() },
    ]);
    const client = new ClefClient({ transport, ...fast });
    const result = await client.run(request);
    expect(result.attempts).toBe(3);
    expect(calls()).toBe(3);
    expect(client.stats().retries).toBe(2);
  });

  it("halves the concurrency limit after a 429", async () => {
    const { transport } = scripted([
      { status: 429, json: null },
      { status: 200, json: choiceBody() },
    ]);
    const client = new ClefClient({ transport, concurrency: 8, ...fast });
    await client.run(request);
    expect(client.concurrencyLimit).toBe(4);
  });

  it("retries 'capacity temporarily exceeded' without shrinking the concurrency limit", async () => {
    const { transport, calls } = scripted([
      {
        status: 429,
        json: {
          errors: [
            { code: 3040, message: "AiError: Capacity temporarily exceeded, please try again." },
          ],
        },
      },
      { status: 200, json: choiceBody() },
    ]);
    const client = new ClefClient({ transport, concurrency: 8, ...fast });
    const result = await client.run(request);
    expect(result.attempts).toBe(2);
    expect(calls()).toBe(2);
    expect(client.concurrencyLimit).toBe(8);
  });

  it("honours Retry-After when it is longer than the backoff", async () => {
    const waits: number[] = [];
    const { transport } = scripted([
      { status: 429, json: null, retryAfterMs: 5000 },
      { status: 200, json: choiceBody() },
    ]);
    const client = new ClefClient({
      transport,
      ...fast,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await client.run(request);
    expect(waits).toEqual([5000]);
  });

  it("does not retry a 400 and surfaces the service message", async () => {
    const { transport, calls } = scripted([
      {
        status: 400,
        json: { errors: [{ message: "required properties are 'model,state,questions'" }] },
      },
    ]);
    const client = new ClefClient({ transport, ...fast });
    await expect(client.run(request)).rejects.toMatchObject({
      kind: "bad_request",
      status: 400,
      message: expect.stringContaining("required properties"),
    });
    expect(calls()).toBe(1);
    expect(client.stats().failures).toBe(1);
  });

  it("treats 401/403 as fatal and does not retry", async () => {
    const { transport, calls } = scripted([
      { status: 403, json: { errors: [{ message: "nope" }] } },
    ]);
    const error = await new ClefClient({ transport, ...fast }).run(request).catch((e) => e);
    expect(error).toBeInstanceOf(ClefError);
    expect(error.kind).toBe("auth");
    expect(error.fatal).toBe(true);
    expect(calls()).toBe(1);
  });

  it("recognises the daily-quota message as fatal, not as a retryable rate limit", async () => {
    const { transport, calls } = scripted([
      {
        status: 429,
        json: {
          errors: [{ message: "you have used up your daily free allocation of 10,000 neurons" }],
        },
      },
    ]);
    const error = await new ClefClient({ transport, ...fast }).run(request).catch((e) => e);
    expect(error.kind).toBe("quota");
    expect(error.fatal).toBe(true);
    expect(calls()).toBe(1);
  });

  it("gives up after maxAttempts on persistent network errors", async () => {
    const { transport, calls } = scripted([new Error("ECONNRESET")]);
    const error = await new ClefClient({ transport, maxAttempts: 3, ...fast })
      .run(request)
      .catch((e) => e);
    expect(error.kind).toBe("network");
    expect(calls()).toBe(3);
  });

  it("reports a timeout when the transport never answers", async () => {
    const transport: Transport = {
      post: (req) =>
        new Promise((_resolve, reject) => {
          req.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    };
    const error = await new ClefClient({ transport, timeoutMs: 20, maxAttempts: 1, ...fast })
      .run(request)
      .catch((e) => e);
    expect(error.kind).toBe("timeout");
  });

  it("rejects a malformed 200 response with a schema error", async () => {
    const { transport } = scripted([
      { status: 200, json: { result: { answers: { move: { type: "choice" } } } } },
    ]);
    const error = await new ClefClient({ transport, ...fast }).run(request).catch((e) => e);
    expect(error.kind).toBe("schema");
  });

  it("treats `success: false` on HTTP 200 as a failure", async () => {
    const { transport } = scripted([
      { status: 200, json: { success: false, errors: [{ message: "model unavailable" }] } },
    ]);
    const error = await new ClefClient({ transport, maxAttempts: 1, ...fast })
      .run(request)
      .catch((e) => e);
    expect(error).toBeInstanceOf(ClefError);
    expect(error.message).toContain("model unavailable");
  });

  it("serves repeated requests from the cache without touching the transport or spending neurons", async () => {
    const { transport, calls } = scripted([{ status: 200, json: choiceBody() }]);
    const client = new ClefClient({ transport, cache: new MemoryCache(), ...fast });
    const first = await client.run(request);
    const second = await client.run({ ...request });
    expect(calls()).toBe(1);
    expect(second.cached).toBe(true);
    expect(second.neurons).toBe(0);
    expect(second.attempts).toBe(0);
    expect(second.answers).toEqual(first.answers);
    expect(second.latencyMs).toBe(first.latencyMs);
    expect(client.stats()).toMatchObject({ calls: 1, cacheHits: 1 });
  });

  it("uses a different cache entry when the model, state or tag changes", async () => {
    const { transport, calls } = scripted([{ status: 200, json: choiceBody() }]);
    const client = new ClefClient({ transport, cache: new MemoryCache(), ...fast });
    await client.run(request);
    await client.run({ ...request, model: "clef" });
    await client.run({ ...request, state: { other: true } });
    await client.run({ ...request, cacheTag: "prompt-v2" });
    expect(calls()).toBe(4);
  });

  it("never lets the number of in-flight requests exceed the limit", async () => {
    let active = 0;
    let peak = 0;
    const transport: Transport = {
      async post() {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { status: 200, json: choiceBody() };
      },
    };
    const client = new ClefClient({ transport, concurrency: 3, ...fast });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => client.run({ ...request, state: { i } })),
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});
