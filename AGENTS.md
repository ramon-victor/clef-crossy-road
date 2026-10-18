# AGENTS.md

Instructions for AI coding agents working in this repo. Humans: start at `README.md`.
Keep this file short. Anything long-lived belongs in `docs/` (linked below), not here.

## Project

Clef Crossy Road: an experiment with Cloudflare's **Clef-flash** decision model (Workers AI, REST only)
in a Crossy Road clone. The default player combines model lookups with a route controller; other conditions
choose moves directly. A panel shows actions, probabilities (derived for `route`), controller steps, latency
and rows crossed. The game is a **deterministic, headless TypeScript port
of the rules of Evan Bacon's Expo-Crossy-Road** (MIT), rendered with Three.js inside a **Tauri v2 desktop app**.
Model comparison runs in a **Node benchmark CLI** (no window, no GPU).

Nothing is deployed to Cloudflare. We only call the Workers AI REST API.

Language: code, identifiers, commits, docs and this file in English.

## Status

Research prototype. **Plain-prompt conditions do not beat "always forward"** (~3.7 rows).
An earlier `DEFAULT_CLEF` (`scene` + `route` + `lookup`, ADR-0011) made 22.4 rows over 7 games spanning two controller revisions,
against 2.7 for always-forward on those seeds. The scripted ceiling with the same controller (`exec-route`, no model)
makes 48.3 over 100 games; that is not a matched comparison. Current gameplay adds a platform clock and fourth lookup on platforms,
retries failed sides and uses longer detours with stall limit 60; `exec-route` now makes 61.6 rows. Old results used 40.
Every report must distinguish controller and model help
(`helpLabel`). **The 100-seed gate is pending**; the earlier 25,000-30,000-neuron estimate needs replanning for current gameplay.
Numbers, method and open work: `docs/results.md`.
The app's "Who plays" lists You, **Clef-flash**, **Clef (27B)** and the three references; both Clef play the gameplay above
(`DEFAULT_CLEF`, `CLEF_27B_CONFIG`), the app opens on Clef-flash at the first cached map (`CLEF_CACHED_SEEDS`, now 6-8), and every
other condition (including the old `json-fx`) opens only as a `Custom` player from
`CCR_PLAYER=clef:<model>:<encoder>:<strategy>[:<manual>]`.
**A cached map only replays if the controller makes the same moves it made when it was cached.** After changing the prompts or `route.ts`, re-run the seeds and check each one with `pnpm bench run ... --seeds N --daily-neurons 0` (any cache miss is refused: nothing is spent) before listing it in the app. `--max-calls` only stops *starting* games; a game in progress runs on.
Commits are authorized (Conventional Commits, one logical change each, with the `Co-Authored-By` trailer). Pushing still needs
the owner's say-so. `.env` holds the real `CF_API_TOKEN` and `CF_ACCOUNT_ID`: never print it. Git checks out LF
(`.gitattributes`), except `*.cmd`, which must stay CRLF.

## Commands

- `pnpm install`; `node scripts/fetch-assets.mjs` once, to download Evan's models/audio locally (gitignored)
- `pnpm run dev` at the root prepares assets and serves `http://localhost:5173`, starting with the free look-ahead player.
- `pnpm run dev:desktop` prepares assets and launches Tauri development (Rust/C++ tools/WebView2 required); stop browser dev first (same port).
- `pnpm typecheck` / `pnpm lint` / `pnpm test`: run all three before declaring work done
- `pnpm check` runs all three. Keep pnpm pinned in `packageManager` (12.14.0), validate upgrades with a frozen install and use the official installer if an older global binary cannot load the pinned version. CI checks Windows, Linux and macOS without credentials or API calls.
- `pnpm --filter @ccr/core test`: core only, no network, ~3 s
- `pnpm bench plan --policies <ids> --seeds 1..100`: estimates neurons and splits a run over days. **Run it before any `run` or `probe-run` that uses a model.**
  From another worktree, use `--root <main checkout>` and `node --env-file=<main checkout>/.env` to share the app's ledger, cache and runs. Do not copy the ledger: separate copies undercount spending. Restart a dev server after recording new cache entries because it keeps its loaded cache in memory.
  To read credentials from another env file, pass it after `.env` (the last file wins): `node --env-file=.env --env-file=<file> apps/bench/src/cli.ts <command>`.
- `pnpm bench run --run <name> --policies <ids> --seeds 1..100 [--latency fixed:300:pipelined]`, `pnpm bench report --run <name>`,
  `pnpm bench diagnose --run <name>` (AUC of the model's P(forward) against real safety) and
  `pnpm bench export --run <name> [--policy id] [--min-score n]` (RL trajectories as NDJSON). Both read files only, no API call.
- `pnpm bench show-input --seed 4 --actions hop_forward [--policy <id>]` prints the exact request a model would get for a state (no network, no key). In the app, the **I** key opens
  a window with what the model read for each decision (state, question, options, answer): use it before guessing why the chicken does something.
- `pnpm bench probe-sample` (up to 114 labelled decision points from free games, including 24 platform states; no API call), `probe-run --run <name> --policies <ids> --max-calls n`
  (one policy decision per state, with the same client, cache and ledger as `run`) and `probe-report --run <name>` (no API call).
- `play.cmd` opens the release app **and shows in its terminal what the model is sent** (`CCR_LOG=full` by default; `brief` or `off`; the same text goes to
  `runs/logs/play.log`); `play-clef.cmd` opens it on Clef-flash, seed 6 (cached, free). `CCR_PLAYER` (`clef-flash`, `clef-27b`, a benchmark policy id...) and
  `CCR_SEED` pick the starting player and map.
- `pnpm --filter @ccr/desktop tauri dev` (app window) / `tauri build --no-bundle` (release exe). `CCR_SELFTEST=1` makes the app
  measure FPS, check rendering and the Rust budget refusal, write `runs/selftest.json` and exit.
- `cargo test --lib` inside `apps/desktop/src-tauri` runs the Rust tests (put `%USERPROFILE%\.cargo\bin` on PATH first).

## Repo map

- `packages/core`: pure deterministic game simulation, zero dependencies. Own `AGENTS.md`.
- `packages/clef`: Workers AI client (schema, retry, cache, **spend budget**) with a `Transport` interface. Own `AGENTS.md`.
- `packages/agent`: `Policy` types, baselines (random, always-forward, lookahead, latency-compensated lookahead), scripted readers
  (`rule-view`, `rule-view-fx`, `rule-lanes`, `rule-moves`, `exec-cross`, `exec-rules`, `exec-route`: references, not models), the words views (`lanes.ts`, `scene.ts`), the executors (`executor.ts`, and `route.ts` with the route search, the lookups of `route-prompts.ts` and `route-policy.ts`), `Memory`, `worldAfter` (the 0.2 s forecast), encoders (`json`, `json-rel`, `grid`, `image`,
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
3. **Secrets**: persist `CF_API_TOKEN` and `CF_ACCOUNT_ID` only in `.env` (gitignored), read by Node or Rust.
   The settings form may hold user-entered replacements until submission/close; never return saved values to the webview,
   store them in browser storage, log them or put them in docs. Settings saves never call the API.
4. **Dependency direction**: `core` imports nothing; `clef` imports nothing of ours; `render` imports `core`;
   `agent` imports `core` and `clef`; apps wire everything together.
5. **Evan's repo is a read-only reference.** Port the rules, not the GSAP/TweenMax code. Keep the MIT notice
   in `NOTICE` once any code is derived from it.

## Boundaries

- **Always**: add a golden test per ported rule that cites the source file in Evan's repo; update the matching
  `docs/` page when a contract or rule changes; record benchmark numbers only
  from real runs.
- **Ask first**: pushes; adding any runtime dependency to `core`; changing the observation schema. Before every commit, scan
  the staged diff for the token prefix and account ids, and never stage `.env`, `runs/`, `dist/`, `target/` or `public/assets/`.
- **Never**: spend above the free tier (10,000 neurons per UTC day, see below); commit `.env`; call
  Cloudflare from the webview; add hints about which move is safe; use `Math.random` in `core`; invent
  numbers for latency, cost or scores.

## Budget (hard rule)

The project's rule is **stay inside the free tier: 10,000 neurons per UTC day** (resets 21:00 in Brazil).
- Every API call must go through `ClefClient` with a `SpendBudget`. The bench CLI uses the ledger
  `runs/cache/spend.ndjson` and refuses new calls locally once it reaches the limit. The limit can be lowered
  with `--daily-neurons`, never raised. Cache hits (`runs/cache/clef.ndjson`) are free and always allowed.
  The desktop app's Rust side enforces the same ceiling (a constant) and writes the same ledger.
- Never write throwaway scripts or `curl` calls that hit the API directly; they bypass the ledger.
- `pnpm bench plan` first, `pnpm bench run` second. The ledger is **per Cloudflare account** (a short hash of the account id
  tags each entry; an untagged entry counts for every account). Runs use `--daily-neurons 9000` to keep a margin and no single
  step uses more than about a sixth of a day. The desktop app plays on the account in `.env`, so leave it a margin when running
  benchmarks there (a seed that is not cached spends). See `docs/adr/0008-daily-budget-free-tier.md`.
- Before a run, estimate: `calls x tokens/decision x neurons per million tokens / 1e6`. Measured: ~1,120 tokens per
  `choice` decision (JSON; ~1,425 for the player's view; ~730 for the `moves` view with `ordered`, ~1,350 per request of the two-question `graph-maneuver`, about 120 neurons per game) and ~3,070 per `critic` decision on clef-flash (3,455 neurons per million tokens); the 27B
  model costs 6.3x more. If the estimate does not fit in what is left of today, shrink the run or wait.
- History: an earlier benchmark run without a spend guard overspent the free tier. Do not repeat it.

## Clef API gotchas (verified 2026-10-14, details in `docs/clef-api.md`)

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
- **Do not assume the model can play.** Clef-flash equals always-forward in every plain-prompt condition tried: it reads
  terrain type, not vehicle kinematics or trees. Only the words + lookups + route-controller stack moves it, with its 100-seed
  gate pending (`docs/results.md`). Real-time play is much harder still: even an exact planner loses most of its score at
  300 ms delay.

## Conventions not obvious from the code

- TypeScript strict, ESM, named exports, Biome for lint/format, Vitest with `*.test.ts` next to the source.
- Conventional Commits. Speeds are tiles/tick inside `core` and tiles/s in anything an agent or human reads.
- Each `docs/` page starts with a one-line purpose. Unknowns go under "Open questions", not guessed.
- Throwaway probes go in the session scratchpad, not the repo. Only findings are written into `docs/`.

## Definition of done

Typecheck, lint and tests pass; determinism test passes if `core` changed; docs updated; no secret in the diff
(`git diff` / grep for the token prefix); no new unexplained dependency.

## Docs index

`docs/README.md` (index) · `architecture` · `game-rules` · `clef-api` · `observation-and-prompts` · `benchmark` ·
`results` (what worked, open work) · `desktop-app` · `internationalization` · `references` · `adr/` (0001-0011). Security notes: `SECURITY.md`.
