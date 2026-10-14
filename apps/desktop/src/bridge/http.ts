import type { Bridge, BudgetStatus } from "./types.ts";

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/__ccr${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok && path !== "/run")
    throw new Error(json.error ?? `bridge error ${response.status}`);
  if (path === "/run" && response.status === 429 && json.error) throw new Error(json.error);
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
