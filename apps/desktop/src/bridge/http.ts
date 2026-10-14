import type { Bridge, BudgetStatus } from "./types.ts";

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/__ccr${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as T & { error?: string };
  // The dev bridge answers a relayed Workers AI call with 200 (the real status is inside the body), so
  // any other status is the bridge itself refusing or failing: surface its message, never a fake response.
  if (!response.ok) throw new Error(json.error ?? `bridge error ${response.status}`);
  return json;
}

/** Browser development only: served by the Vite plugin in dev-bridge.ts. */
export const httpBridge: Bridge = {
  kind: "http",
  run: (model, body) => call("/run", { model, body }),
  cacheGet: (key) => call("/cache/get", { key }),
  cachePut: async (key, value) => {
    await call("/cache/put", { key, value });
  },
  budget: () => call<BudgetStatus>("/budget"),
};
