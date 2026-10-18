<div align="center">

# Clef Crossy Road

**A decision-model experiment with visible choices, probabilities and controller steps.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2024-339933?logo=nodedotjs&logoColor=white)](#quick-start)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](#repository-layout)
[![Tauri](https://img.shields.io/badge/Tauri-v2-FFC131?logo=tauri&logoColor=black)](https://v2.tauri.app/)
[![Workers AI](https://img.shields.io/badge/Cloudflare-Workers%20AI-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers-ai/)

<img src="docs/images/panel.png" alt="The AI panel: who plays, the last decision, rows crossed, decisions, latency and tokens" width="300">

<sub>The AI panel with the free look-ahead reference (it reports no probabilities).<br>The default Clef player also shows action probabilities derived from its lookup answers, latency and tokens.</sub>

</div>

## What is this?

Clef Crossy Road tests Cloudflare's **Clef-flash** decision model (Workers AI, REST only) in a deterministic, headless
TypeScript port of the rules of Evan Bacon's [Expo-Crossy-Road](https://github.com/EvanBacon/Expo-Crossy-Road). The default
player asks the model three lookups about the scene, then a route controller executes the hops, waits and detours. Other
conditions ask the model to choose each move directly.

A [Tauri v2](https://v2.tauri.app/) desktop app, or your browser, renders the game with Three.js next to a panel showing
actions, probabilities, controller steps, latency, tokens and rows crossed. A Node benchmark CLI compares players on
identical seeds with paired confidence intervals.

Nothing is deployed to Cloudflare. The project only calls the Workers AI REST API and checks a daily free-tier ceiling
(10,000 neurons per UTC day) before each uncached call.

## Results so far

| Player | Games | Rows crossed (mean) |
|---|---:|---|
| `random` | 100 | 1.84 |
| `always-forward` | 100 | 3.78 |
| Clef-flash, plain prompts (JSON, ASCII grid, the player's view of the screen) | 100 | 3.67 – 3.73 (no better than always forward) |
| Clef-flash, top-down image of the observation | 100 | 3.36 (worse) |
| **Clef-flash + route controller** (`scene` · `route` · `lookup`, the app default) | 7 | **22.4** [10.9, 35.7] |
| Same controller, scripted, **no model** (`exec-route`) | 100 | 48.3 |
| `lookahead` (reads the simulator, no model) | 100 | 44.75 |

Given the game state and a plain question, Clef-flash plays like "always forward": it puts its highest probability on advancing
even when a platform is elsewhere and the forward hop drowns the chicken. Describing the scene in words,
turning each option into a one-field lookup with solved examples, and letting a controller do the hopping and walk detours
moved it a long way (on a 90-state probe it agrees with the ideal follower of the lookups in 94% of the states).

Read the numbers with these caveats:

- **The controller is our code.** It does the hopping, the timing and the detours; the model only answers three one-field
  lookups. The fair comparison for the headline row is the scripted ceiling with the same controller (48.3), not
  `always-forward`. Every condition is labelled with how much help the code gives.
- **The headline row is 7 games**, hence the wide interval. The 100-seed gate is still pending: roughly 25,000–30,000 neurons,
  several days on the free tier. These seven games span two controller revisions and are not a matched comparison with
  the 100-game scripted references.

Full tables, method and open questions: [docs/results.md](docs/results.md).

## How it works

```mermaid
flowchart LR
    G["<b>@ccr/core</b><br/>deterministic game<br/>seeded, fixed 60 Hz"]
    E["<b>Encoder</b><br/>words · JSON · grid"]
    C["<b>ClefClient</b><br/>retry · cache · spend ceiling"]
    W[("Workers AI<br/>Clef-flash")]
    P["<b>Controller</b><br/>route search · timing"]

    G -- "Observation<br/>(physical facts only)" --> E
    E -- "state + question + options" --> C
    C -- REST --> W
    W -- "choices + probabilities" --> P
    P -- "hop or wait" --> G
```

- **Deterministic core.** `@ccr/core` uses seeded randomness and fixed simulation ticks: same seed and same actions give an identical
  snapshot hash. Each ported rule cites the upstream file it comes from ([docs/game-rules.md](docs/game-rules.md)).
- **Fairness rule.** The model sees measured physical facts and what a player could perceive (the whole screen, where things will
  be in 0.2 s, its last moves). It never sees a judgement such as "safe", "reachable" or a list of valid moves
  ([ADR-0005](docs/adr/0005-observation-fairness-rule.md), [ADR-0009](docs/adr/0009-perception-memory-judgement.md)).
- **Spend guard.** A daily ceiling is enforced before every API call, in the TypeScript client and again in the Rust process;
  cache hits are free ([ADR-0008](docs/adr/0008-daily-budget-free-tier.md)).
- **Benchmark CLI.** Many seeds × many players, resumable runs, bootstrap confidence intervals and a diagnostic that scores the
  model's probabilities against the real outcome of each move ([docs/benchmark.md](docs/benchmark.md)).

## Quick start

| Needs | For | Version |
|---|---|---|
| Node.js | everything | 24 or newer |
| pnpm | everything | 10 |
| Git and an internet connection | first run (downloads the game assets) | any |
| Rust, MSVC C++ build tools, WebView2 | desktop app only | stable Rust |

```bash
git clone https://github.com/ramon-victor/clef-crossy-road.git
cd clef-crossy-road
pnpm install
pnpm run dev
```

Open **http://localhost:5173**. The first run downloads Evan Bacon's 3D models, audio and font from the pinned upstream revision
(see [Credits and legal](#credits-and-legal)). The browser starts with the **free look-ahead player**, so no token, cache or
Rust is needed. Pick **You** in **Who plays** to play with the arrow keys or WASD. Stop the server with <kbd>Ctrl</kbd>+<kbd>C</kbd>.

The desktop window:

```bash
pnpm run dev:desktop      # Tauri dev mode, hot reload; first build is slow
```

Stop any `pnpm run dev` first: both use port 5173. For a release build, run `pnpm --filter @ccr/desktop build`, then
`pnpm tauri build --no-bundle` inside `apps/desktop`, and double-click `play.cmd`, which also prints what the model is sent.
Keys, the **I** input inspector and the `CCR_*` variables are in [docs/desktop-app.md](docs/desktop-app.md).

> **Platform.** Developed and tested on Windows 11. The `.cmd` launchers and WebView2 are Windows-specific. Browser mode only
> needs Node and pnpm, but it has not been verified on macOS or Linux.

## Using a model

1. Create a Cloudflare API token with **only** the *Workers AI* permission and an expiry date.
2. In the app, open **Setup → Cloudflare → Configure**, enter your **Account ID** and the **API token**, and save. They are
   written to the local `.env` and applied without a restart; saving never calls the API. Alternatively copy `.env.example`
   to `.env` and fill in `CF_ACCOUNT_ID` and `CF_API_TOKEN` (the benchmark reads that file too).
3. Choose **Clef-flash** or **Clef (27B)** in **Who plays**.

`.env` is gitignored; never commit it or paste its contents into an issue or pull request.

**Mind the budget.** The project's rule is to stay inside the free tier: 10,000 neurons per UTC day per account. The default Clef-flash
request costs roughly 6 neurons and a game takes tens of requests; the 27B model costs about 6.3 times more. Run
`pnpm bench plan` before any benchmark that calls a model: it estimates the cost and splits a run into days that fit.

**Replays are free only with a local cache.** The decision cache lives in `runs/` (gitignored), so a fresh clone has none. The
desktop app opens on Clef-flash at seed 6, which then calls the API and needs credentials. Use the look-ahead player to stay at
zero cost.

## Benchmark

```bash
pnpm bench plan   --policies always-forward,lookahead --seeds 1..100          # estimate cost, split over days
pnpm bench run    --run my-run --policies always-forward,random,lookahead --seeds 1..100
pnpm bench report --run my-run                                                # means, paired deltas, 95% CIs
pnpm bench diagnose --run my-run                                              # AUC of P(forward) vs. real safety
pnpm bench show-input --seed 4 --actions hop_forward                          # the exact request a model would get
```

Model players are named `clef:<model>:<encoder>:<strategy>[:<manual>]`, for example `clef:clef-flash:scene:route:lookup`.
The grammar, the reference players, the stall rule and latency injection are in [docs/benchmark.md](docs/benchmark.md).
Spending commands refuse to start once the day's ceiling is reached; `--daily-neurons` can only lower it.

## Repository layout

| Path | What it is |
|---|---|
| `packages/core` | Deterministic game simulation, zero dependencies |
| `packages/clef` | Workers AI client: schema, retry, cache, spend budget, `Transport` interface |
| `packages/agent` | Players and baselines, encoders, prompts, route controller, episode runner |
| `packages/render` | Three.js scene built from a read-only snapshot |
| `apps/bench` | Benchmark CLI (no window, no GPU) |
| `apps/desktop` | Tauri v2 app: Preact UI plus the Rust side that holds the credentials |
| `docs/` | Architecture, rules, API notes, results, decision records |

Dependency direction: `core` imports nothing; `clef` imports nothing of ours; `render` imports `core`; `agent` imports `core`
and `clef`; the apps wire everything together ([docs/architecture.md](docs/architecture.md)).

## Documentation

| I want to… | Read |
|---|---|
| See what worked and what did not | [docs/results.md](docs/results.md) |
| Understand the design | [docs/architecture.md](docs/architecture.md) |
| See how the game rules were ported | [docs/game-rules.md](docs/game-rules.md) |
| Know what the model is shown | [docs/observation-and-prompts.md](docs/observation-and-prompts.md) |
| Call the Clef API or estimate cost | [docs/clef-api.md](docs/clef-api.md) |
| Run or extend the benchmark | [docs/benchmark.md](docs/benchmark.md) |
| Use the app | [docs/desktop-app.md](docs/desktop-app.md) |
| Know why a decision was made | [docs/adr/](docs/adr/) |
| Find sources and related work | [docs/references.md](docs/references.md) |

## Development

```bash
pnpm typecheck && pnpm lint && pnpm test       # TypeScript
cd apps/desktop/src-tauri && cargo test --lib  # Rust
```

`pnpm --filter @ccr/core test` runs the simulation tests alone, with no network, in a few seconds. See
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request; [AGENTS.md](AGENTS.md) holds the working rules for AI coding
agents. Security notes and how to report a problem: [SECURITY.md](SECURITY.md).

## Credits and legal

- Code and documentation: [MIT](LICENSE).
- The game rules are ported from Evan Bacon's [Expo-Crossy-Road](https://github.com/EvanBacon/Expo-Crossy-Road) (MIT; pinned
  revision in [NOTICE](NOTICE)). Its 3D models, audio and font replicate the original Crossy Road. **They are not in this
  repository**: `scripts/fetch-assets.mjs` downloads them locally and they are gitignored. Release builds embed them, so do not
  distribute binaries without replacing the assets and the name.
- This project is not affiliated with or endorsed by Hipster Whale (makers of Crossy Road), Evan Bacon or Cloudflare.
  "Crossy Road", "Cloudflare" and "Workers AI" belong to their owners.
- The app icon is original art, generated by `scripts/make-icon.mjs`.
