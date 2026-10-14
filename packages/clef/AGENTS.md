# AGENTS.md: packages/clef

Applies to everything under `packages/clef`. The root `AGENTS.md` still applies. Contract and findings: `docs/05-integracao-clef.md`.

## What this package is

The only code in the repo that talks to Workers AI from TypeScript. Transport-agnostic: Node (`@ccr/clef/node`) and the
desktop app (a bridge to Rust commands) plug in through the `Transport`, `DecisionCache` and `SpendBudget` interfaces.

## Hard rules

- **Spending is capped before the request leaves the process.** `ClefClient.run` asks the `SpendBudget` right before every
  network attempt and throws a fatal `quota` error ("Nothing was sent") when the day's ledger has reached the limit.
  Never add a path that sends without that check. Cache hits are free and skip it.
- The default ceiling is the free tier (`FREE_NEURONS_PER_DAY`, 10,000). Do not add a way to raise it from a CLI flag or env var.
- The ledger is per Cloudflare account: entries carry `accountTag(accountId)` (FNV-1a 64, hex) and `spentToday()` counts only the
  current account. An entry without a tag, or an unknown current account, counts toward everything. Never write the raw account id to disk.
  The Rust side (`apps/desktop/src-tauri`) computes the same tag; both are tested on the same vectors.
- The token never appears in a log, an error message, a thrown value or a returned object. Errors carry only the service's
  `errors[].message`. `node.ts` holds the credentials in a closure.
- Interfaces stay async-capable (`T | Promise<T>`) because the desktop app's cache and ledger live behind IPC.
- NDJSON files (cache, ledger) end a partial last line before appending. A glued record in the ledger would under-count spending.
- Error kinds matter: `capacity` (code 3040) is retried without shrinking concurrency; `rate_limit` halves it;
  `auth` and `quota` are fatal; `bad_request` is never retried.

## Commands

`pnpm --filter @ccr/clef test` (fake transport, no network) and `pnpm --filter @ccr/clef typecheck`.

## Gotchas

- Neurons are derived from the published rate, US$ 0.011 per 1,000 neurons; the published per-model figures reproduce (tested).
- Tests use injected `now`, `sleep` and `random`; keep new time-dependent code injectable.
- Sync-only stale editor errors about `Promise<...>` against these interfaces are cache artefacts; `tsc` is the source of truth.
