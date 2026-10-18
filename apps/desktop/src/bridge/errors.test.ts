import { afterEach, expect, it, vi } from "vitest";
import { createClefClient } from "./clef.ts";
import { BridgeError, bridgeError, errorInfo } from "./errors.ts";
import { httpBridge } from "./http.ts";
import type { Bridge } from "./types.ts";

afterEach(() => vi.unstubAllGlobals());

it("keeps a structured HTTP failure through the bridge and into the session error description", async () => {
  const failure = {
    code: "quota",
    message: "Nothing was sent",
    params: { spent: 10000, limit: 10000 },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: failure }), { status: 429 })),
  );
  const result = httpBridge.run("clef-flash", {});
  await expect(result).rejects.toBeInstanceOf(BridgeError);
  await expect(result.catch(errorInfo)).resolves.toEqual({
    code: "quota",
    detail: failure.message,
    params: failure.params,
  });
});

it("does not retry missing credentials or replace their presentation code with a network error", async () => {
  const run = vi.fn(async () => {
    throw new BridgeError({ code: "credentials_missing", message: "Configure credentials" });
  });
  const client = createClefClient({
    run,
    budget: async () => ({ spent: 0, limit: 10000, day: "2026-10-17" }),
    cacheGet: async () => null,
  } as unknown as Bridge);
  const request = {
    model: "clef-flash" as const,
    state: {},
    questions: {
      move: { type: "choice" as const, instructions: "Test only", criteria: { stay: "wait" } },
    },
  };
  await expect(client.run(request)).rejects.toMatchObject({
    code: "credentials_missing",
    kind: "auth",
    fatal: true,
  });
  expect(run).toHaveBeenCalledOnce();
});

it("retains an unknown diagnostic without pretending that its prose is a known error code", () => {
  expect(errorInfo(bridgeError("CF_API_TOKEN happens to appear in this old diagnostic"))).toEqual({
    code: "bridge",
    detail: "CF_API_TOKEN happens to appear in this old diagnostic",
  });
});

it("accepts only finite numeric error parameters from the backend", () => {
  const failure = bridgeError({
    code: "quota",
    message: "Nothing sent",
    params: { spent: 10000, limit: Infinity, detail: "invalid", nan: NaN },
  });
  expect(errorInfo(failure)).toEqual({
    code: "quota",
    detail: "Nothing sent",
    params: { spent: 10000 },
  });
  expect(
    errorInfo(bridgeError({ code: "quota", message: "Nothing sent", params: [10000] })),
  ).not.toHaveProperty("params");
});
