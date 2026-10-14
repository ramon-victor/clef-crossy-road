import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import {
  type CachedEntry,
  type ClefModel,
  FREE_NEURONS_PER_DAY,
  neuronsForTokens,
} from "@ccr/clef";
import { createNodeTransport, FileBudget, FileCache } from "@ccr/clef/node";
import type { Plugin } from "vite";

/**
 * DEV-ONLY stand-in for the Rust commands, so the UI can be developed and tested in a normal
 * browser. It exposes the same four operations as the Tauri build and enforces the same rules:
 * the token stays in this Node process, the free-tier ceiling is a constant, and every spend is
 * written to the shared ledger (runs/cache/spend.ndjson). It is not part of the production build
 * (`apply: "serve"`) and only answers same-origin requests.
 */
export function devBridge(): Plugin {
  const root = resolve(import.meta.dirname, "../..");
  const MODELS: ClefModel[] = ["clef", "clef-flash", "clef-omni"];

  let budget: FileBudget | undefined;
  let cache: FileCache | undefined;
  let transport: ReturnType<typeof createNodeTransport> | undefined;

  const state = () => {
    budget ??= new FileBudget(
      resolve(root, "runs/cache/spend.ndjson"),
      FREE_NEURONS_PER_DAY,
      undefined,
      process.env.CF_ACCOUNT_ID,
    );
    cache ??= new FileCache(resolve(root, "runs/cache/clef.ndjson"));
    return { budget, cache };
  };

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };

  const readJson = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolveBody, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    });

  return {
    name: "ccr-dev-bridge",
    apply: "serve",
    configureServer(server) {
      try {
        process.loadEnvFile(resolve(root, ".env"));
      } catch {
        // No .env: Clef calls will report that the credentials are missing.
      }

      server.middlewares.use("/__ccr", async (req, res) => {
        // Refuse anything that is not the app itself talking to its own origin (CSRF from other tabs).
        const origin = req.headers.origin;
        const host = req.headers.host;
        if (origin && new URL(origin).host !== host) return send(res, 403, { error: "bad origin" });
        if (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") {
          return send(res, 403, { error: "bad fetch site" });
        }

        try {
          const url = new URL(req.url ?? "/", "http://localhost");
          const { budget: ledger, cache: store } = state();

          if (req.method === "GET" && url.pathname === "/budget") {
            return send(res, 200, {
              spent: ledger.spentToday(),
              limit: FREE_NEURONS_PER_DAY,
              day: new Date().toISOString().slice(0, 10),
            });
          }
          if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
          const body = await readJson(req);

          if (url.pathname === "/cache/get") {
            return send(res, 200, store.get(String(body.key)) ?? null);
          }
          if (url.pathname === "/cache/put") {
            store.set(String(body.key), body.value as CachedEntry);
            return send(res, 200, { ok: true });
          }
          if (url.pathname === "/run") {
            const model = String(body.model) as ClefModel;
            if (!MODELS.includes(model))
              return send(res, 400, { error: `model not allowed: ${model}` });
            if (!ledger.canSpend()) {
              return send(res, 429, {
                error: `Local daily budget reached: ${Math.round(ledger.spentToday())} of ${FREE_NEURONS_PER_DAY} neurons used today (UTC). Nothing was sent.`,
              });
            }
            transport ??= createNodeTransport();
            const response = await transport.post({ model, body: body.body });
            const tokens = (
              response.json as { result?: { usage?: { input_tokens?: number } } } | null
            )?.result?.usage?.input_tokens;
            if (response.status >= 200 && response.status < 300 && typeof tokens === "number") {
              ledger.record({
                model,
                inputTokens: tokens,
                neurons: neuronsForTokens(model, tokens),
              });
            }
            return send(res, 200, response);
          }
          return send(res, 404, { error: "not found" });
        } catch (error) {
          // Never echo anything that could contain credentials.
          return send(res, 500, {
            error: error instanceof Error ? error.message.slice(0, 300) : "error",
          });
        }
      });
    },
  };
}
