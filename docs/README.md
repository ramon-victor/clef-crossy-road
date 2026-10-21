# Documentation

Start with the [project README](../README.md) for what this is and how to run it. These pages go deeper, grouped by what you are
trying to do.

## Understand

| Page | What you get |
|---|---|
| [Results](results.md) | What worked and what did not, with the tables, and what is still open |
| [Architecture](architecture.md) | Layers, packages and their dependency rules, the life of one decision, run modes |
| [Decision records](adr/) | Why each significant choice was made (index below) |

## Use

| Page | What you get |
|---|---|
| [Desktop app](desktop-app.md) | Running the app, keys, the AI panel, launch variables |
| [Internationalization](internationalization.md) | Language selection, translation boundaries, catalogs and contributor checks |
| [Benchmark](benchmark.md) | Running and extending the benchmark: commands, player ids, rules, latency injection, the spend budget |

## Reference

| Page | What you get |
|---|---|
| [Game rules](game-rules.md) | The ported rules of Expo-Crossy-Road, deliberate deviations, the simulation API |
| [Observation and prompts](observation-and-prompts.md) | The fairness rule, what the model is shown, encoders, strategies, prompts |
| [Clef API](clef-api.md) | The Workers AI REST contract, gotchas, cost, latency, error policy |
| [References](references.md) | Sources and related work |

## Decision records

| ADR | Decision |
|---|---|
| [0001](adr/0001-headless-core-and-rules-port.md) | Headless core and a port of the original rules |
| [0002](adr/0002-workers-ai-rest-no-deploy.md) | Workers AI over REST only, nothing deployed |
| [0003](adr/0003-typescript-pnpm-monorepo.md) | TypeScript and pnpm workspaces |
| [0004](adr/0004-deterministic-simulation.md) | Seeded, fixed-step deterministic simulation |
| [0005](adr/0005-observation-fairness-rule.md) | The observation holds measured physical facts only |
| [0006](adr/0006-no-fine-tuning-no-self-host.md) | No fine-tuning or self-hosting for now |
| [0007](adr/0007-tauri-desktop-token-in-rust.md) | Tauri desktop app, credentials held by Rust |
| [0008](adr/0008-daily-budget-free-tier.md) | Daily spend ceiling inside the free tier, enforced before the call |
| [0009](adr/0009-perception-memory-judgement.md) | Perception and memory may reach the model; judgement may not |
| [0010](adr/0010-words-rules-maneuver-executor.md) | Words, rules in the options and a maneuver executor, with labelled help levels |
| [0011](adr/0011-route-controller-three-lookups.md) | Route controller and three one-field lookups |
| [0012](adr/0012-clef-decides-to-step-off-no-rescue.md) | Clef decides to step off its cell; the controller no longer rescues it |

## Conventions

- Numbers appear only if they come from a real run or a cited source; unknowns go under "Open questions", not guessed.
- Changed a contract (API behaviour, a game rule, the observation schema)? Update its page. Made or reversed a decision? Add or
  amend an ADR instead of editing history silently.
- The Clef service is young and its documentation has already changed once (context window 64K → 24K). Re-check
  [clef-api.md](clef-api.md) against the Cloudflare docs before relying on it.
- Docs, code, identifiers and commits are in English.
