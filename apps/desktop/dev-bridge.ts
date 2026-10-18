import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import {
  budgetRefusal,
  type CachedEntry,
  CLEF_MODELS,
  type ClefModel,
  FREE_NEURONS_PER_DAY,
  neuronsForTokens,
} from "@ccr/clef";
import {
  CACHE_FILE,
  createNodeTransport,
  FileBudget,
  FileCache,
  LEDGER_FILE,
} from "@ccr/clef/node";
import type { Plugin } from "vite";
import { CredentialsStore, CredentialValidationError } from "./credentials.ts";
import type { BridgeFailure } from "./src/bridge/errors.ts";

/**
 * DEV-ONLY stand-in for the Rust commands, so the UI can be developed and tested in a normal
 * browser. It exposes the same operations as the Tauri build and enforces the same rules:
 * saved credentials stay in this Node process, the free-tier ceiling is a constant, and every spend is
 * written to the shared ledger (runs/cache/spend.ndjson). It is not part of the production build
 * (`apply: "serve"`) and only answers same-origin requests.
 */
export function devBridge(
  options: { root?: string; fetchImpl?: typeof fetch; environment?: NodeJS.ProcessEnv } = {},
): Plugin {
  const root = options.root ?? resolve(import.meta.dirname, "../..");

  let cache: FileCache | undefined;
  let budget: FileBudget | undefined;
  let budgetAccount: string | undefined;
  const accountBudget = (account: string | undefined) => {
    if (!budget || budgetAccount !== account) {
      budget = new FileBudget(resolve(root, LEDGER_FILE), FREE_NEURONS_PER_DAY, undefined, account);
      budgetAccount = account;
    }
    return budget;
  };

  const failure = (
    code: BridgeFailure["code"],
    message: string,
    params?: Record<string, number>,
  ): BridgeFailure => ({ code, message, ...(params ? { params } : {}) });

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(body));
  };

  const readJson = (
    req: IncomingMessage,
    limit = Number.POSITIVE_INFINITY,
  ): Promise<Record<string, unknown>> =>
    new Promise((resolveBody, reject) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      req.on("data", (c: Buffer) => {
        bytes += c.length;
        if (bytes > limit) return reject(new Error("Request too large"));
        chunks.push(c);
      });
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
      const credentials = new CredentialsStore(root, options.environment ?? process.env);

      server.middlewares.use("/__ccr", async (req, res) => {
        // Refuse anything that is not the app itself talking to its own origin (CSRF from other tabs).
        const origin = req.headers.origin;
        const host = req.headers.host;
        if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) {
          return send(res, 403, { error: failure("bridge", "bad host") });
        }
        try {
          if (origin && new URL(origin).host !== host)
            return send(res, 403, { error: failure("bridge", "bad origin") });
        } catch {
          return send(res, 403, { error: failure("bridge", "bad origin") });
        }
        if (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") {
          return send(res, 403, { error: failure("bridge", "bad fetch site") });
        }

        try {
          const url = new URL(req.url ?? "/", "http://localhost");
          if (url.pathname === "/credentials") {
            if (req.method === "GET") return send(res, 200, credentials.status());
            if (req.method !== "POST")
              return send(res, 405, { error: failure("bridge", "method not allowed") });
            if (!req.headers["content-type"]?.startsWith("application/json")) {
              return send(res, 415, { error: failure("bridge", "JSON required") });
            }
            try {
              return send(res, 200, credentials.save(await readJson(req, 8192)));
            } catch (error) {
              return send(res, error instanceof CredentialValidationError ? 400 : 500, {
                error:
                  error instanceof CredentialValidationError
                    ? failure(error.code, error.message)
                    : failure("credentials_save", "Could not save local Cloudflare credentials."),
              });
            }
          }
          const current = credentials.current();
          const ledger = accountBudget(current.accountId);
          cache ??= new FileCache(resolve(root, CACHE_FILE));
          const store = cache;

          if (req.method === "GET" && url.pathname === "/budget") {
            return send(res, 200, {
              spent: ledger.spentToday(),
              limit: FREE_NEURONS_PER_DAY,
              day: new Date().toISOString().slice(0, 10),
            });
          }
          if (req.method !== "POST")
            return send(res, 405, { error: failure("bridge", "method not allowed") });
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
            if (!CLEF_MODELS.includes(model))
              return send(res, 400, {
                error: failure("model_not_allowed", `model not allowed: ${model}`),
              });
            if (!ledger.canSpend()) {
              return send(res, 429, {
                error: failure("quota", budgetRefusal(ledger.spentToday(), FREE_NEURONS_PER_DAY), {
                  spent: ledger.spentToday(),
                  limit: FREE_NEURONS_PER_DAY,
                }),
              });
            }
            if (!current.accountId || !current.apiToken) {
              return send(res, 400, {
                error: failure(
                  "credentials_missing",
                  "CF_API_TOKEN and CF_ACCOUNT_ID are required. Open Setup and configure Cloudflare.",
                ),
              });
            }
            const transport = createNodeTransport({
              accountId: current.accountId,
              token: current.apiToken,
              ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
            });
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
          return send(res, 404, { error: failure("bridge", "not found") });
        } catch {
          // Never echo anything that could contain credentials.
          return send(res, 500, {
            error: failure("bridge", "Local bridge request failed."),
          });
        }
      });
    },
  };
}
