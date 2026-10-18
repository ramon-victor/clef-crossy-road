# Benchmark

How to compare policies on the same deterministic maps: the commands, the policy ids, the episode rules, the gate and the budget guard. Results are in [results.md](results.md).

## Principles

- **Same seeds, paired comparison.** A seed is a map. Every policy plays the same seeds, and the difference in rows crossed is computed seed by seed with a 95% percentile-bootstrap interval (10,000 resamples of seeds, fixed bootstrap seed, so reports are reproducible).
- **Baselines before models.** A score means nothing without the floor (`always-forward`) and a ceiling (`lookahead`, or the scripted `exec-*` references for scaffolded conditions).
- **Only real runs are reported.** `runs/<name>/meta.json` stores the episode settings, the prompt version and the creation time, and `episodes.ndjson` every action, so any game replays exactly. Hosted models can change without notice, so record when a run was made.
- **Fairness.** A model sees the `Observation`, plus perception (the whole screen, where things will be in 0.2 s) and memory (its last moves). Never judgement (safe, reachable, time-to-collision): [ADR-0005](adr/0005-observation-fairness-rule.md), [ADR-0009](adr/0009-perception-memory-judgement.md).

## Commands

Run from the repository root. Policies that never call the API need no credentials; any run with a `clef` policy needs `CF_API_TOKEN` and `CF_ACCOUNT_ID` in `.env` ([SECURITY](../SECURITY.md)). **Run `plan` before any `run` or `probe-run` that uses a model.**

```bash
pnpm bench plan --policies clef --seeds 1..100                        # neurons per seed, split over days; no API call
pnpm bench run --run refs --policies always-forward,random,lookahead,exec-cross,exec-route --seeds 1..100   # free; resumable
pnpm bench plan --policies clef:clef-flash:json:choice:full --seeds 1..10
pnpm bench run --run flash-json --policies clef:clef-flash:json:choice:full --seeds 1..10 --daily-neurons 9000 --max-calls 250
pnpm bench report --run refs,flash-json --ref always-forward          # scores, endings, model calls, paired CI -> reports/
pnpm bench diagnose --run flash-json                                  # AUC of P(hop_forward) vs real safety, per terrain; files only
pnpm bench export --run refs --policy lookahead --min-score 20        # RL trajectories (observation, action, reward, done) as NDJSON
pnpm bench show-input --seed 4 --actions hop_forward --policy clef    # the exact request for a state; sends nothing, needs no key
pnpm bench probe-sample --seeds 1..300                                # up to 114 labelled decision points from free players
pnpm bench plan --policies clef:clef-flash:json:choice:full,clef --seeds 1 --assume-decisions 114
pnpm bench probe-run --run p-flash --policies clef:clef-flash:json:choice:full,clef --max-calls 400 --daily-neurons 9000
pnpm bench probe-report --run p-flash --ref clef:clef-flash:json:choice:full   # scores vs labels; agreement with the ideal follower
```

Only `run` and `probe-run` can call the API. A probe makes one policy decision per sampled state; a strategy may put several questions in that request. The original eight strata total 90 states: `water-deadly` (24), `water-open` (12), `road-deadly` (12), `road-open` (8), `tree` (10), `tree-stuck` (10), `grass-open` (8), `rail` (6). Two platform strata add 12 each (`platform-edge`, `platform-far`), for up to 114 states. Historical 90-state results predate that addition. Labels never reach the model. Estimate a probe with one seed and `--assume-decisions` set to its actual sample size.

## Policy ids

Fixed ids: `always-forward`, `random`, `lookahead`, `lookahead-<depth>`, `lookahead-comp:<ms>`, `rule-view`, `rule-view-fx`, `rule-lanes`, `rule-moves`, `exec-cross`, `exec-rules`, `exec-route`.

Model policies: `clef:<model>:<encoder>:<strategy>[:<manual>]`, with the manual defaulting to `full`. `clef` alone is `clef:clef-flash:scene:route:lookup`, the default gameplay of the app and the bench. Reports print the full id and a "Sees" label: the encoder's level plus the help added, for example `words + rules + graph + route executor`. `model` is `clef-flash` (hosted default), `clef` (the 27B, 6.3x the cost per token) or `clef-omni` (adds audio and video).

The [policy-id reference](observation-and-prompts.md#policy-ids) lists every encoder, strategy, manual and supported combination. See also [encoders](observation-and-prompts.md#encoders), [decision strategies](observation-and-prompts.md#decision-strategies) and [prompts](observation-and-prompts.md#prompts) for what each condition adds.

The parser rejects unsupported combinations before a run starts. In particular, `route` requires both `scene` and the explicit `lookup` manual; use `clef` for that default, or `clef:clef:scene:route:lookup` for the 27B.

## Benchmark rules

| Rule | Default | Flag |
|---|---|---|
| World ticks after each action: one full hop, 60 ticks per second, so 0.2 s | 12 | `--decision-ticks` |
| Maximum decisions per game (reaching it is "capped") | 300 | `--max-decisions` |
| Stall rule: end the game after this many consecutive decisions without a new furthest row (`0` disables) | 60 | `--stall-limit` |
| Parallel games | 1 for baselines, 4 with a `clef` policy | `--concurrency` |

A game ends on death, at the decision cap, or on a stall. The rules apply to every policy alike, and the stall rule also bounds the cost of a policy that dithers forever. Executor steps count as decisions. Settings are fixed in `meta.json`; resuming a run with different ones is refused. The score, "rows crossed", is the furthest row reached minus the starting row.

Historical results recorded before 2026-10-17 used stall limit 40. Pass `--stall-limit 40` when reproducing those conditions, and compare both seeds and controller versions. The app has no 300-decision benchmark cap; a cached app replay may continue beyond it.

## Reference players

| Id | Reads | What it is |
|---|---|---|
| `random` | nothing | Uniform over the five actions. Absolute floor. |
| `always-forward` | nothing | `hop_forward` every decision. The honest floor: the first rows are grass. |
| `lookahead`, `lookahead-<depth>` | the simulator | Exhaustive search over `depth` decisions (default 4) on a clone of the exact simulator. A ceiling, not a contender: models may not read the simulator. |
| `lookahead-comp:<ms>` | the simulator | The same, planning from the world as it will be `<ms>` later (for latency runs). |
| `rule-view`, `rule-view-fx` | text map now / at +0.2 s | Scripted readers of exactly what the `view` and `view-fx` encoders show: is that view enough to play well? |
| `rule-lanes`, `rule-moves` | words | Scripted ideal followers of the `lanes` words and of the `ordered` options, one decision per hop. |
| `exec-cross` | words | Always `cross_ahead`, with the manoeuvre executor: **what the executor does alone**, the floor of any executor condition. |
| `exec-rules` | words | A scripted manoeuvre chooser (the written rules) plus the executor. |
| `exec-route` | scene words | A scripted chooser plus the route controller: **the ceiling of the `route` condition** without a model. |

The scripted references are never models. Compare a scaffolded model condition with its matching references on the same seeds to distinguish controller performance from the model's contribution.

## The gate

> The gate passes if, for some condition, the lower bound of the 95% bootstrap interval of the paired difference in rows crossed against `always-forward` is above zero, with at least 100 seeds.

`report` labels each comparison `better` (whole interval above zero), `worse` (below) or `indistinguishable` (contains zero). Fewer than 100 seeds can show a signal but cannot pass the gate.

## Latency injection

A model answers in hundreds of milliseconds and the game does not wait. `--latency none | fixed:<ms> | recorded`, optionally suffixed `:pipelined`, keeps the world running while the policy "thinks", deterministically and without network (`recorded` replays the latency stored with each cached answer). Policy labels get `@lat300`, `@latp300`, `@latrec` or `@latprec` (`p` = pipelined).

- **Serial** (default): the world runs for the latency with the chicken idle, then the stale action is applied and its hop plays out.
- **Pipelined** (like the app in real time): the next question goes out as soon as an action is applied, so the hop overlaps the wait. An action arriving mid-hop waits in the game's input queue.

The gate uses step-by-step play, without latency. Measured scores and interpretation are in [results.md](results.md#latency-finding).

## Budget

The hard rule is to stay inside the Workers AI free tier, **10,000 neurons per account and UTC day**. It is a safety control enforced in code.

- **Ledger.** Each paid call appends a line to `runs/cache/spend.ndjson`. `ClefClient` checks it **before** every network call and refuses locally (a fatal `quota` error, "nothing was sent") once the day's spend reaches the ceiling. Cache hits (`runs/cache/clef.ndjson`) are free and always allowed.
- **Ceiling.** `--daily-neurons <n>` can only lower it; runs here use `9000` for a 10% margin. `--daily-neurons 0` refuses every call that is not cached: it proves a run replays from the cache and spends nothing.
- **Per account.** The free tier is per account, so entries carry a short hash of the account id (the id itself is never written). An untagged entry counts against every account, so incomplete records can only make the guard stricter. The Cloudflare dashboard stays the final source of truth: the ledger only sees what this project sent.
- **One path.** All calls go through `ClefClient`; the desktop app enforces the same ceiling in its Rust process ([ADR-0007](adr/0007-tauri-desktop-token-in-rust.md)). A script that calls the API directly bypasses the ledger and is not allowed. Details: [ADR-0008](adr/0008-daily-budget-free-tier.md).
- **`--max-calls`** (default 1500 for `run`, 400 for `probe-run`) only stops *starting* games or questions. Games in flight (up to `--concurrency`) run to the end and can overshoot the plan; the daily ceiling is the real stop. Exit code 3 means the call cap was reached, 2 a fatal error such as the quota.
- **Plan first.** `plan` estimates decisions per game times neurons per decision, reserves 10% of each day and splits the seeds over as many days as needed, printing `--seeds` ranges ready to paste. It assumes no cache hits, uses built-in token estimates (marked `(est.)` when not measured) and accepts `--assume-decisions n`.
- **Cache validity.** The key is the model, state, questions, images and a tag of prompt version, encoder, strategy and manual, so any prompt or encoder change misses. With a controller (`maneuver`, `graph-maneuver`, `route`) a cached game also replays only if the controller makes the same moves it made when cached: after changing `route.ts` or a prompt, re-run the seeds and check each with `--daily-neurons 0`.
- **Worktrees.** Share the canonical checkout's ledger and cache with `--root <checkout>` and `node --env-file=<checkout>/.env apps/bench/src/cli.ts ...`. Do not copy the ledger to another worktree. Restart a running dev server after recording new answers because it caches them in memory.

Per-model rates and measured request sizes are in [Clef API: price, limits and cost](clef-api.md#price-limits-and-cost). Cost depends on the condition and the number of model requests, not the number of controller hops. The estimate for the default condition's pending 100-seed evaluation is in [Results: open work](results.md#open-work); use `plan` to split it before spending.
