# AGENTS.md: packages/core

Applies to everything under `packages/core`. The root `AGENTS.md` still applies; this file adds the rules that only matter here.
Full spec: `docs/game-rules.md`.

## What this package is

A deterministic, headless port of the rules of EvanBacon/Expo-Crossy-Road (MIT, see root `NOTICE`).
It has **no runtime dependencies** and must stay renderer-agnostic.

## Hard rules

- No `Math.random`, `Date`, `performance`, timers, DOM, network, `crypto`, `Intl` or Node imports in `src/`.
  `src/purity.test.ts` enforces this by scanning the code; the `tsconfig` also loads no DOM/Node types.
  Randomness comes only from `createRng(seed, stream, domain)`. Time is counted in 60 Hz ticks.
- Row content must depend only on `(seed, z, previous row)`. Never let it depend on when or by whom a row is first requested.
- Keep upstream's coordinates inside the core (`+x` is screen-left, `z` grows forward). Flip to `col = -x` only in `observe.ts`.
- `observe()` may expose measured physical facts only (ADR-0005). Adding a key means updating `OBSERVATION_KEYS`, its test
  and `docs/adr/0005-observation-fairness-rule.md`. Never add safety labels, legal-move lists or time-to-collision.
- Imports use explicit `.ts` extensions and only erasable TypeScript syntax (no enums, namespaces or parameter properties),
  so Node can run the sources directly.

## Porting a rule

1. Read the upstream file; cite it in a comment next to the constant or branch.
2. Preserve its quirks unless `docs/game-rules.md` lists a deliberate deviation (add a row there if you add one).
3. Add a test that fails without the rule. Use `src/testing.ts` (`rowsGenerator`, `carAt`, `logAt`, ...) to build tiny hand-made worlds.
4. Update the "Ported rules" table in `docs/game-rules.md`.

## Commands

- `pnpm --filter @ccr/core test` runs Vitest; `pnpm --filter @ccr/core typecheck` runs both tsconfigs.
- Run `pnpm lint` from the repo root before finishing.

## Gotchas

- Upstream's `Fill.empty` is never read: rows 5-9 still get random interior trees. This is intentional.
- A train's lethal zone is centred on its origin, not on its body. This is intentional.
- `Game.step` advances `DECISION_TICKS` (12 = one full hop) after applying the action. `act` + `advance` give finer control.
- An input that arrives while a hop is in the air is **queued** (one slot, the last wins) and starts on the tick that hop lands, after the landing was checked. Upstream teleports the hero to the end of the hop instead, which let fast key presses cross water and roads; do not bring that back (`docs/game-rules.md`, D9).
