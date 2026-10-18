# ADR-0006 · No fine-tuning and no self-hosting for now

- **Status:** accepted · **Date:** 2026-10-14

## Context and problem statement

The weights of Clef and Clef-flash are open (Apache 2.0, on Hugging Face). Cloudflare has announced a reinforcement-learning fine-tuning platform (AI Gateway, Workers AI, Containers as sandboxes, its own trainer, bring-your-own-model) that was available only with the support of a dedicated team, with a self-serve version planned. The 256K context window applies only to self-hosted weights. Zero-shot play was weak in the first twelve conditions tried, where Clef-flash behaved like "always forward"; a later condition in which our code phrases the state and a controller does the hopping scores clearly higher over a few games. Evidence and caveats are in [results](../results.md).

## Considered options

- Hosted models only, zero-shot, with no training and no hosting of weights.
- RL fine-tuning on the hosted platform Cloudflare announced: not self-serve at the time of writing.
- Self-hosting Clef-flash on a local GPU: larger context and no per-token cost, but it adds operations work and a capability gain is not guaranteed.

## Decision outcome

Chosen option: "hosted models only, without training", because it keeps the scope small and spending bounded ([ADR-0008](0008-daily-budget-free-tier.md)) while the open question is how much of the game the hosted model can play. Later conditions use solved examples and controllers, so they are reported separately from zero-shot play.

- No fine-tuning and no self-hosting of weights for now; revisit if hosted zero-shot play plateaus or a self-serve fine-tuning path becomes available.
- The deterministic core ([ADR-0004](0004-deterministic-simulation.md)) and the trajectory export keep the door open: `pnpm bench export` replays recorded decisions on the simulator and writes `(observation, action, reward, done)` steps as NDJSON, using only observations that obey [ADR-0005](0005-observation-fairness-rule.md). It reads files only and calls no API.

### Consequences

- Good, because the scope is small and the cost stays inside the free tier.
- Bad, because improvement is limited to prompts, encoders and the controller ([ADR-0010](0010-words-rules-maneuver-executor.md), [ADR-0011](0011-route-controller-three-lookups.md)); whether a trained model would read positions and velocities better is untested.
