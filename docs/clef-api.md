# Clef API

Reference for the Workers AI REST contract that `packages/clef` implements: request and response shapes, service quirks, price and limits, latency, error handling and the budget guard on every call.

> Checked against the Cloudflare docs on 2026-10-14; the service is young, re-verify before relying on it.

Evidence tags: **[doc]** Cloudflare documentation, **[ind]** independent test with a small sample, **[obs]** measured in this project. Sources are listed in [references.md](references.md).

## Endpoint

```
POST https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/@cf/cloudflare/{model}
Authorization: Bearer {CF_API_TOKEN}
Content-Type: application/json
```

Models: `clef-flash` (9B, the default for the app and the benchmark), `clef` (27B) and `clef-omni` (text, image, audio and video). There is no Worker and no deploy, only this call ([ADR-0002](adr/0002-workers-ai-rest-no-deploy.md)). Credentials live in `.env`; see [Using a model](../README.md#using-a-model).

## Request and response

```json
{
  "model": "clef-flash",
  "state": { "...": "object, array or string (see observation-and-prompts.md)" },
  "questions": {
    "move": {
      "type": "choice",
      "instructions": "Fixed, versioned text with the rules of the game.",
      "criteria": {
        "hop_forward": "Hop one row forward (dz +1), same column.",
        "stay": "Do not move during this decision step."
      }
    }
  },
  "images": ["data:image/png;base64,..."]
}
```

Question types [doc]: `choice` (one option of `criteria`), `noul` (probability of "yes"; no `criteria`) and `score` (a level of an ordered list; unused here). `images` is optional. A request holds up to 64 questions [doc]. The REST response, abridged:

```json
{ "result": { "model": "clef-flash",
    "answers": { "move": { "type": "choice", "choice": "hop_forward",
      "probabilities": { "hop_forward": 0.8839, "stay": 0.0127 }, "confidence": 0.7316 } },
    "usage": { "input_tokens": 444, "output_tokens": 0 } },
  "success": true, "errors": [], "messages": [] }
```

- A `noul` answer is `{ "type": "noul", "noul": 0.4564 }`: the number is in the field `noul` [obs].
- The REST API wraps the payload in `result`; the Worker binding returns it bare. `parseResult` in `packages/clef/src/schema.ts` accepts both.
- Probabilities are rounded to 4 decimals [ind]. The same request returns identical probabilities [obs], so caching answers is valid.

## Quirks

| Fact | Evidence |
|---|---|
| `instructions` is required in every question. Omitting it gives a **400** with the generic message "required properties at '/' are 'model,state,questions'", which does not name the field | [obs], [ind] |
| `model` is documented as required, but the REST API **accepted a request without it (200)**. Always send it; do not rely on the omission | [doc] vs [obs] |
| Object keys in `state` and option IDs are sorted alphabetically (`lane_10` before `lane_9`) and are part of the model's input. Send anything with an order as an **array** and use descriptive option IDs; the order of the options does not matter | [ind] |
| `choice` always returns an option, even when none fits. `confidence` is undocumented and is not the top probability; report it separately | [ind], [obs] |
| A long `state` is truncated **from the end**. Questions in one request can influence each other; use separate requests to measure one alone | [ind] |
| Images: base64 only (no URLs), PNG, JPEG or WebP, up to 4; each at most 4 MiB and 16 MP, 8 MiB in total; about `(w/32)·(h/32) + 3` tokens each, at most 1,024. `data:image/png;base64,...` works | [doc], [obs] |
| Hosted context is 24,576 tokens. The launch post still says 64K; the changelog of 2026-10-09 lowered it | [doc] |

## Price, limits and cost

| Item | Clef-flash | Clef (27B) | Source |
|---|---|---|---|
| US$ per million input tokens | 0.038 | 0.240 | [doc] |
| Neurons per million input tokens | 3,455 | 21,818 | [doc] |
| Output tokens | not billed | not billed | [doc] |

- Free tier: 10,000 neurons per account and day, reset at 00:00 UTC; beyond it a Workers Paid plan is needed [doc]. Usage above the free allocation can be billed, which is why the project enforces its own ceiling (below).
- Rate limit: not documented for Clef; text generation defaults to 300 requests per minute [doc]. Five requests in parallel all returned 200, with no 429 (one-off) [obs].
- `clef-omni` is priced at US$ 0.15 per million input tokens in `packages/clef/src/models.ts`.

A call costs `input_tokens × neurons per million / 1e6`. The 444-token smoke prompt is about 1.5 neurons on Clef-flash and 9.7 on the 27B, so roughly 6,500 and 1,000 such calls fit in a free day. Measured input tokens per decision, with the Clef-flash cost derived from the published rate:

| Condition | Tokens | Neurons |
|---|---|---|
| `choice` with `json`, `json-rel`, `grid`, `view`, `view-fx` or `json-fx` | ~1,120 to ~1,540 | ~3.9 to ~5.3 |
| `choice` with `image` (one 416×384 picture plus the instructions) | ~972 | ~3.4 |
| `choice` with `lanes` + `rules` | ~1,115 | ~3.9 |
| `choice` with `moves` + `ordered` | ~730 | ~2.5 |
| `graph-maneuver` with `moves` (two questions per request) | ~1,350 | ~4.7 |
| Historical `route` with `scene` (three questions per request) | ~1,750 | ~6.0 |
| `critic` with `json` (five `noul` questions) | ~3,070 | ~10.6 |

The 27B costs 6.3 times as much per token; measured, 143 decisions cost 3,507 neurons (24.5 each), in line with the published price. In the manoeuvre strategies the hops a controller makes are not model calls and cost nothing.

Current `route` adds a fourth `ride` question while on a platform. The three-question measurements above are historical; do not treat them as a measured average for current gameplay. `pnpm bench plan` still uses estimates, so leave a margin.

## Latency

Measured from Node in Brazil, network included. These are one-off measurements, not benchmarks.

| Measurement [obs] | p50 | p95 | min | max |
|---|---|---|---|---|
| Clef-flash, 20 sequential calls, same state, connection reused | 326 ms | 764 ms | 300 ms | 764 ms |
| 4 to 6 parallel requests, prompts of about 1,100 tokens | ~930 ms | ~3.3 s | | |

- The first call on a cold connection took 994 ms. Cloudflare publishes a server-side median of 38.8 ms [doc], so most of the 326 ms is network; an independent test from Japan measured 166 ms [ind].
- Use `--concurrency 1` to measure latency. At about 3 decisions per second, a car at 4.8 columns/s moves about 1.6 columns per round trip, so real-time play needs latency compensation. The benchmark is step-by-step by default; `--latency` injects a delay ([benchmark.md](benchmark.md)).

## Client error policy

`ClefClient` makes at most 4 attempts per request (first try included). Backoff starts at 500 ms and doubles, with up to 25% jitter; a `Retry-After` header is honoured as a minimum. The limit is 10 s per attempt (the desktop Rust client has its own 20 s HTTP limit).

| Situation | Kind | Action |
|---|---|---|
| 429 rate limit | `rate_limit` | Retry; halve the concurrency (one slot comes back after 20 successes in a row) |
| 429 "Capacity temporarily exceeded" (code 3040) | `capacity` | Retry; keep the concurrency. Seen in about 1 of 30 calls during bursts, even with 4 requests in parallel: momentary service capacity, not the account's limit [obs] |
| 5xx, network failure, timeout | `server`, `network`, `timeout` | Retry |
| 400 or another 4xx | `bad_request` | No retry: it is a payload bug |
| 401 or 403 | `auth` | Fatal: stop the whole run |
| Cloudflare's daily-allocation message, or the local budget is spent | `quota` | Fatal: stop the whole run |
| Response outside the schema | `schema` | Fail explicitly; never guess an action |

## Budget on every call

Every call goes through `ClefClient` with a `SpendBudget`. Once a concurrency slot is free and right before sending, the client checks the day's spend (UTC, per Cloudflare account) against the ceiling; if it is reached it throws a fatal `quota` error ending in "Nothing was sent." Cache hits cost nothing and always pass. The cache key hashes the model, state, questions, images and a tag with the prompt version, encoder, strategy and manual, so a repeated seed is free.

The ceiling is the free tier (10,000 neurons) and can only be lowered (`--daily-neurons`). The desktop app's Rust side applies the same ceiling and writes the same ledger (`runs/cache/spend.ndjson`), which keeps a one-way tag of the account, never its id. Calls in flight when the limit is crossed are still billed, at most the client's concurrency. Scripts and `curl` calls bypass the ledger and must not be used. See [ADR-0008](adr/0008-daily-budget-free-tier.md).

## Smoke test

The CLI prints the budget before and after:

```bash
pnpm bench plan --policies clef:clef-flash:json:choice:full --seeds 1       # estimates, calls nothing
pnpm bench run  --run smoke --policies clef:clef-flash:json:choice:full --seeds 1 --max-calls 3
```

With budget left, one game is played in 2 to 5 calls and the last line reads `budget: X / 10000 neurons spent today (UTC)`. With the budget spent: `STOPPED: quota: Local daily budget reached ... Nothing was sent.` and zero calls. `--max-calls` only stops *starting* games; a game in progress runs on.

## Open questions

1. Clef's real rate limit. Only the capacity error appeared with up to 16 requests in parallel; it was not explored further to stay inside the free tier.
2. Whether the hosted model changes without notice: the changelog of 2026-10-09 says Clef became up to 2x faster "with weights unchanged". Record the date and `usage` with every result.
3. The token figures for the words views and the `graph`, `route` strategies come from single runs, and `pnpm bench plan` still uses estimates for them (`packages/agent/src/cost.ts`).
