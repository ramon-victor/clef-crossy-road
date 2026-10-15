# AGENTS.md

Instructions for AI coding agents working in this repo. Humans: start at `README.md`.
Keep this file short. Anything long-lived belongs in `docs/` (linked below), not here.

## Project

Clef Crossy Road: an experiment where Cloudflare's **Clef-flash** decision model (Workers AI, REST only)
makes 100% of the movement decisions in a Crossy Road clone, with a panel showing the chosen action,
per-action probabilities, latency and rows crossed. The game is a **deterministic, headless TypeScript port
of the rules of Evan Bacon's Expo-Crossy-Road** (MIT), rendered with Three.js inside a **Tauri v2 desktop app**.
Model comparison runs in a **Node benchmark CLI** (no window, no GPU).

Nothing is deployed to Cloudflare. We only call the Workers AI REST API.

Language: code, identifiers, commits and this file in English. `docs/` is in Brazilian Portuguese.

## Status

Phases 0-4 are built (406 TS tests + 20 Rust tests). **The gate was NOT passed, in 12 conditions**: Clef-flash (JSON, grid,
critic-go, minimal manual, relative columns, and the player's view with the whole screen, motion and memory) plays like "always forward" (~3.7 rows),
image input is significantly worse, and Clef 27B chose "forward" every time (`docs/07-experimentos.md`). Diagnosis: 72-96% of hops into water are
fatal and the model puts its top probability on "forward" even when the platform is written right in front of it. Scripted readers of the same views make
13-19 rows, so the information is in the view and the model does not use it. Clef 27B is the only one that moves in the probes (71% fatal choices into
deadly water against 96%) and it costs ~30 neurons per decision. `clef-omni` with a picture did not change anything. Writing the options as "when each move applies" (`manual: routing`, how the service's docs use `criteria`) flipped the
model from "forward" to "mostly wait or left" without making it read the state (AUC 0.56-0.63; worse than always-forward over 7 games): the option text decides, not the column.
The app offers **one** Clef (`DEFAULT_CLEF`: clef-flash, `json-fx` view, choice, full manual); other views, strategies and the 27B are benchmark axes, not players.
The owner authorized commits on 2026-10-14 (history is on `main`, Conventional Commits, one logical change each, with the
`Co-Authored-By` trailer). Pushing still needs their say-so. `.env` holds a working `CF_API_TOKEN` and `CF_ACCOUNT_ID`; `.env.second` (gitignored) holds a second account's.
Installed: Node 24, pnpm 10, git, MSVC, WebView2, Rust 1.99 (rustup, user-level). Git checks out LF (`.gitattributes`), except
`*.cmd`, which must stay CRLF.

## Commands

- `pnpm install`; `node scripts/fetch-assets.mjs` once, to download Evan's models/audio locally (gitignored)
- `pnpm typecheck` / `pnpm lint` / `pnpm test`: run all three before declaring work done
- `pnpm --filter @ccr/core test`: core only, no network, ~3 s
- `pnpm bench plan --policies <ids> --seeds 1..100`: estimates neurons and splits a run over days. **Run it before any `run` or `probe-run` that uses a model.**
  For the second account: `node --env-file=.env --env-file=.env.second apps/bench/src/cli.ts <command>` (the last file wins).
- `pnpm bench run --run <name> --policies <ids> --seeds 1..100 [--latency fixed:300:pipelined]`, `pnpm bench report --run <name>`,
  `pnpm bench diagnose --run <name>` (AUC of the model's P(forward) against real safety) and
  `pnpm bench export --run <name> [--policy id] [--min-score n]` (RL trajectories as NDJSON). Both read files only, no API call.
- `pnpm bench show-input --seed 4 --actions hop_forward [--policy <id>]` prints the exact request a model would get for a state (no network, no key). In the app, the **I** key opens
  a window with what the model read for each decision (state, question, options, answer): use it before guessing why the chicken does something.
- `pnpm bench probe-sample` (90 labelled decision points from the free players' games, no API call), `probe-run --run <name> --policies <ids> --max-calls n`
  (one question per policy and state, same client, cache and ledger as `run`) and `probe-report --run <name>` (no API call): about a tenth of the cost of whole games.
- `play.cmd` opens the release app; `play-clef.cmd` opens it on Clef-flash, seed 1 (cached, free). `CCR_PLAYER` and `CCR_SEED`
  pick the starting player and map.
- `pnpm --filter @ccr/desktop tauri dev` (app window) / `tauri build --no-bundle` (release exe). `CCR_SELFTEST=1` makes the app
  measure FPS, check rendering and the Rust budget refusal, write `runs/selftest.json` and exit.
- `cargo test --lib` inside `apps/desktop/src-tauri` runs the Rust tests (put `%USERPROFILE%\.cargo\bin` on PATH first).

## Repo map

- `packages/core`: pure deterministic game simulation, zero dependencies. Own `AGENTS.md`.
- `packages/clef`: Workers AI client (schema, retry, cache, **spend budget**) with a `Transport` interface. Own `AGENTS.md`.
- `packages/agent`: `Policy` types, baselines (random, always-forward, lookahead, latency-compensated lookahead), scripted readers
  (`rule-view`, `rule-view-fx`: references, not models), `Memory`, `worldAfter` (the 0.2 s forecast), encoders (`json`, `json-rel`, `grid`, `image`,
  `view`, `view-fx`, `json-fx`, each with a perception level), `DEFAULT_CLEF`, versioned prompts, `ClefPolicy`, episode runner with latency injection.
- `packages/render`: Three.js scene built from a read-only `Snapshot`, using Evan's models.
- `apps/bench`: Node CLI (`run`, `report`, `plan`, `diagnose`, `export`, `probe-*`). `apps/desktop`: Tauri v2 app (Preact UI + Rust commands). Own `AGENTS.md`.
- `docs/`: specs, ADRs, references. `runs/` and `reports/` are generated and gitignored.
- Package boundaries come from pnpm's strict `node_modules`: a package can only import what its `package.json` declares.

## Hard rules

1. **Determinism in `packages/core`**: no `Math.random`, `Date.now`, `performance.now`, DOM, Three.js or I/O.
   Randomness comes from the seeded PRNG. Time is counted in fixed 60 Hz ticks. Same seed + same actions
   must give an identical snapshot hash.
2. **Fairness rule** (`docs/adr/0005`): an `Observation` contains only measured physical facts (terrain,
   positions, extents, velocities in tiles/s, signal phase). It must never contain anything derived from the
   candidate actions: no "safe/unsafe" labels, no legal-move list, no time-to-collision with the player.
   Do not change the observation schema without updating that ADR and the schema test. What the model is shown beyond the
   `Observation` follows `docs/adr/0009`: perception (the whole screen, where things will be in 0.2 s) and memory (its last moves)
   may enter; judgement (safe, reachable, valid moves, time-to-collision) never. Every encoder declares a perception level.
3. **Secrets**: `CF_API_TOKEN` and `CF_ACCOUNT_ID` live only in `.env` (gitignored). Read them only in Node
   (bench) or Rust (desktop). Never log them, put them in docs, or send them to the webview.
4. **Dependency direction**: `core` imports nothing; `clef` imports nothing of ours; `render` imports `core`;
   `agent` imports `core` and `clef`; apps wire everything together.
5. **Evan's repo is a read-only reference.** Port the rules, not the GSAP/TweenMax code. Keep the MIT notice
   in `NOTICE` once any code is derived from it.

## Boundaries

- **Always**: add a golden test per ported rule that cites the source file in Evan's repo; update the matching
  `docs/` page (and its "Verificado em" date) when a contract or rule changes; record benchmark numbers only
  from real runs.
- **Ask first**: pushes; adding any runtime dependency to `core`; changing the observation schema. Before every commit, scan
  the staged diff for the token prefix and account ids, and never stage `.env`, `runs/`, `dist/`, `target/` or `public/assets/`.
- **Never**: spend above the free tier (10,000 neurons per UTC day, see below); commit `.env`; call
  Cloudflare from the webview; add hints about which move is safe; use `Math.random` in `core`; invent
  numbers for latency, cost or scores.

## Budget (hard rule)

The owner's rule is **stay inside the free tier: 10,000 neurons per UTC day** (resets 21:00 in Brazil).
- Every API call must go through `ClefClient` with a `SpendBudget`. The bench CLI uses the ledger
  `runs/cache/spend.ndjson` and refuses new calls locally once it reaches the limit. The limit can be lowered
  with `--daily-neurons`, never raised. Cache hits (`runs/cache/clef.ndjson`) are free and always allowed.
  The desktop app's Rust side enforces the same ceiling (a constant) and writes the same ledger.
- Never write throwaway scripts or `curl` calls that hit the API directly; they bypass the ledger.
- `pnpm bench plan` first, `pnpm bench run` second. The ledger is **per Cloudflare account** (a short hash of the account id
  tags each entry; an untagged entry counts for every account). On 2026-10-14 the old account (`0ba9...`) is over, `df5a...` (`.env`) used
  8,739 of 10,000 (the app included) and `f173...` (`.env.second`) 6,763. Runs use `--daily-neurons 9000` to keep a margin and no single step
  uses more than about a sixth of a day. See `docs/adr/0008`.
- Before a run, estimate: `calls x tokens/decision x neurons per million tokens / 1e6`. Measured: ~1,120 tokens per
  `choice` decision (JSON; ~1,425 for the player's view) and ~3,070 per `critic` decision on clef-flash (3,455 neurons per million tokens); the 27B
  model costs 6.3x more. If the estimate does not fit in what is left of today, shrink the run or wait.
- History: on 2026-10-14 this project overspent (~26,300 neurons, about US$ 0.18 billed). Do not repeat it.

## Clef API gotchas (verified 2026-10-14, details in `docs/05-integracao-clef.md`)

- Body: docs require `model: "clef-flash"` (the REST API accepted a request without it, so do not rely on that).
  `instructions` is required per question; omitting it gives a 400 with a misleading generic message.
- REST wraps the answer in `result`; the Worker binding does not. Normalize in `packages/clef`.
- Object keys in `state` are sorted alphabetically and option IDs are sorted as strings and are model input.
  Send rows as an **array**; use descriptive IDs (`hop_forward`, `hop_back`, `hop_left`, `hop_right`, `stay`).
- `choice` always returns an option. `confidence` is undocumented and is not the top probability.
- Hosted context is 24K tokens. Images: base64 PNG/JPEG/WebP only, max 4. `data:image/png;base64,...` is accepted (verified).
- Rate limit for Clef is undocumented. `HTTP 429 "Capacity temporarily exceeded"` (code 3040) is transient service
  capacity, seen in ~1 of 30 calls: retry with backoff, do not shrink concurrency.
- Round trip from Brazil: p50 ~326 ms sequential with a small prompt, ~930 ms under 4-6 parallel requests (not the
  38.8 ms server-side figure). Responses are deterministic, so the cache is valid.
- **Do not assume the model can play.** The 100-seed gate showed Clef-flash equal to always-forward in every condition
  tried: it reads terrain type, not vehicle kinematics or trees. Real-time play is much harder still: even an exact
  planner loses most of its score at 300 ms delay (`docs/07-experimentos.md`).

## Conventions not obvious from the code

- TypeScript strict, ESM, named exports, Biome for lint/format, Vitest with `*.test.ts` next to the source.
- Conventional Commits. Speeds are tiles/tick inside `core` and tiles/s in anything an agent or human reads.
- Each `docs/` page starts with a status/verified-date header. Unknowns go under "Perguntas abertas", not guessed.
- Throwaway probes go in the session scratchpad, not the repo. Only findings are written into `docs/`.

## Definition of done

Typecheck, lint and tests pass; determinism test passes if `core` changed; docs updated; no secret in the diff
(`git diff` / grep for the token prefix); no new unexplained dependency.

## Docs index

`docs/README.md` (index) · `00-viabilidade` · `02-arquitetura` · `04-game-core` · `05-integracao-clef` ·
`06-observacao-e-prompts` · `07-experimentos` (results) · `08-ui-desktop` · `09-roadmap` (next steps) ·
`10-seguranca-e-licencas` · `adr/` · `references.md`
