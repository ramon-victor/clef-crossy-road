# ADR-0004 · Deterministic simulation

- **Status:** accepted · **Date:** 2026-10-14

## Context and problem statement

Comparing models requires the same map and the same traffic for every policy. The original game depends on `Math.random`, on the frame rate and on `setTimeout` (the train signal). The reasons for a separate core are in [ADR-0001](0001-headless-core-and-rules-port.md); the rules and their deviations are in [game rules](../game-rules.md).

## Considered options

- Keep upstream's behaviour (unseeded `Math.random`, per-frame movement, wall-clock timers): map and traffic would differ between runs and with the display's refresh rate.
- A seeded, tick-based core in which positions are pure functions of the seed and the tick.

## Decision outcome

Chosen option: "a seeded, tick-based core", because it makes games reproducible, paired comparisons valid and cached model decisions reusable.

- A seeded PRNG (sfc32) is the only source of randomness. Each row draws from its own stream, derived from (seed, row, domain), so a row's content does not depend on the order in which rows are generated or on how fast a policy plays.
- Time advances in fixed 60 Hz ticks and everything is counted in ticks. A hop is two 0.1 s tweens, 12 ticks (`HOP_TICKS`). The train signal, which upstream drives with timers (15 toggles 200 ms apart), is on for 180 ticks (3 s) after each train wrap (`TRAIN_LIGHT_TICKS`).
- Vehicles, platforms and trains are closed-form functions of the global tick, so every row is already "in motion" from tick 0 and look-ahead clones are cheap.
- Rows are generated on demand and memoised; they are immutable and shared between clones. Upstream's 20-row pool of reused row objects is not reproduced.
- The core uses no `Date`, `performance`, timers, DOM, Three.js or I/O; a purity test scans the source and the `tsconfig` loads no DOM or Node types.
- Same seed plus the same actions must give an identical snapshot hash (tested, including clones and independence from the order rows are first looked at).

### Consequences

- Good, because games are reproducible, benchmark comparisons are paired by seed, and the decision cache stays valid.
- Good, because the renderer interpolates between snapshots and cannot influence the logic.
- Bad, because upstream values are in units per frame; the conversion to tiles per second is explicit and tested.
