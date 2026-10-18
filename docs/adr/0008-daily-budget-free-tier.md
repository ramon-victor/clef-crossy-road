# ADR-0008 · Daily budget inside the free tier, enforced before the call

- **Status:** accepted · **Date:** 2026-10-14

## Context and problem statement

The project's rule is to stay inside the Workers AI free tier: 10,000 neurons per Cloudflare account per UTC day. An earlier benchmark run, made without a spend guard, exceeded it. Its only protection was a per-run call cap (`--max-calls`), which does not know what the day has already cost, and nothing else refused the calls. Spending has to be refused locally, before the call, against a record that persists across runs and processes and covers both the CLI and the app.

## Considered options

- A per-run call cap only: does not know the day's spend (the earlier situation)
- Relying on Cloudflare to stop at the free allocation: not guaranteed, since the service may keep accepting calls above it
- A ledger enforced by TypeScript only: the webview or another process could bypass or forget it
- A ledger with no account distinction: the allocation is per account, so it would block an account that has spent nothing and hide the spend of another
- A persistent per-account, per-UTC-day ledger consulted before every call, in both runtimes

## Decision outcome

Chosen option: the last one, because it refuses new calls once recorded spend reaches the ceiling. Calls already in flight can still be billed, so runs need a margin and the Cloudflare dashboard remains the final source of truth.

1. A **persistent ledger** of spend per UTC day, `runs/cache/spend.ndjson`, one line per paid call.
2. `ClefClient` asks the `SpendBudget` **before each network call** and refuses locally when the day's spend has reached the cap: a `ClefError` of kind `quota`, which is fatal, with the message "Nothing was sent." Cache hits (`runs/cache/clef.ndjson`) cost nothing and always pass.
3. The default and maximum cap is the free tier, 10,000 neurons. The CLI can only **lower** it (`--daily-neurons`).
4. The desktop app enforces **the same cap in the Rust process**, as a constant, and Rust writes the ledger: the webview can neither spend more nor forget to record ([ADR-0007](0007-tauri-desktop-token-in-rust.md)).
5. `pnpm bench plan` estimates neurons per policy and splits a run into days that fit the free tier, before anything is spent.
6. The ledger is **per account**. Each entry carries `account`, the FNV-1a 64-bit hash of the account id in hex; the id itself is never stored. TypeScript (`accountTag`) and Rust (`account_tag`) compute the same value and are tested against the same vectors. Spend is summed only for the current `CF_ACCOUNT_ID`. An entry without a tag counts against every account, and when no account is known every entry counts: old or incomplete records can only make the guard stricter, never looser. The per-account split exists so the guard is accurate for whichever account is configured; it is not a way to raise any limit.
7. Ledger and cache tolerate a line truncated by a crash: the partial line is terminated before appending, otherwise the next record would be unreadable and spend would be **undercounted**.

### Consequences

- Good, because both the CLI and the app stop sending new requests once the recorded daily ceiling is reached.
- Good, because spend is auditable (a text file) and the cost of a run is known before it starts.
- Bad, because the ledger is local: another process or machine using the same account does not see it. The Cloudflare dashboard remains the source of truth for real usage, since the ledger only knows what this project sent.
- Bad, because overshoot is small but possible: calls already in flight when the cap is crossed are still charged, at most the client's concurrency.
- Bad, because scripts that call the API directly bypass the ledger; `AGENTS.md` forbids them.
