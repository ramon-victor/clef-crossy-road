# ADR-0001 · Headless core and rules port

- **Status:** accepted · **Date:** 2026-10-14

## Context and problem statement

Expo-Crossy-Road couples its game logic to Three.js (rows are `Group` objects, collision reads `mesh.position`), draws from an unseeded `Math.random` and moves cars a fixed step per rendered frame, ignoring the frame delta. It can be played, but it cannot be used to compare models on the same map or to run thousands of games without a GPU. The determinism requirements are in [ADR-0004](0004-deterministic-simulation.md); the ported rules and the deliberate deviations are in [game rules](../game-rules.md).

## Considered options

- Fork Expo-Crossy-Road and patch it in place: fastest way to get something on screen, but it cannot run headless and is hard to test.
- Build on a different open-source Crossy Road clone: the experiment targets the rules of one specific, MIT-licensed reference game (including trains), and a different game would change what is measured.
- A new headless package that ports the rules, with upstream's assets and look reused only in the renderer.

## Decision outcome

Chosen option: "a new headless package", because it is the only option that gives reproducible seeds, a window-less benchmark and fast tests while keeping the rules of the reference game.

- `@ccr/core` is plain TypeScript with zero dependencies. It ports the rules (grass, road, rail, water, logs, lily pads, trains, the hop and the collisions).
- `@ccr/render` reuses upstream's models and look and draws from a read-only `Snapshot`; it never feeds back into the simulation.
- The upstream repo is a read-only reference: rules are ported, its GSAP/TweenMax animation code is not.
- Every ported rule gets a test that cites the upstream source file it comes from. Intentional deviations are listed in [game rules](../game-rules.md).
- The MIT notice for derived code is kept in `NOTICE`.

### Consequences

- Good, because seeds are reproducible, the benchmark needs no window, tests are fast, and the core doubles as a reinforcement-learning environment (see [ADR-0006](0006-no-fine-tuning-no-self-host.md)).
- Good, because the renderer stays small and replaceable.
- Bad, because the rules must be ported and tested, and a port can drift from the original; tests that cite the upstream source files mitigate this.
- Bad, because the code diverges from upstream, so the MIT attribution has to be maintained.
