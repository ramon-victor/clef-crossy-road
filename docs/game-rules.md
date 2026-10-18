# Game rules

Specification of `@ccr/core`, the deterministic TypeScript port of the Crossy Road rules, for contributors who change or check a rule.

The rules come from Evan Bacon's [Expo-Crossy-Road](https://github.com/EvanBacon/Expo-Crossy-Road) (MIT), pinned at revision `6f2e84e` (full SHA and license in [NOTICE](../NOTICE)). The upstream engine, map, player, rows, nodes and settings were read in full under `src/`; the port lives in `packages/core/src/`. The upstream repository is a read-only reference: the rules are ported, its GSAP/TweenMax animation code is not.

## Why not use the original engine

| Problem in upstream | Consequence | Solution in the core |
|---|---|---|
| `Math.random` without a seed in rows, cars, logs and pads | Maps cannot be reproduced | Seeded sfc32 PRNG, one stream per row |
| Movement per frame; `dt` is passed and ignored | Speed depends on the monitor | Fixed 60 Hz step, counted in ticks |
| Rows are Three.js `Group`s; collision reads `mesh.position` | Cannot run without a GPU or DOM | Entities are plain structures (`Mover`) |
| `setTimeout` drives the train signal | Depends on the wall clock | Tick count (180) |
| The engine depends on React Native's `Dimensions` and Expo's GL | Cannot run headless | Separate renderer (`@ccr/render`) |

## Invariants covered by tests

| Invariant | Tested in |
|---|---|
| Same seed + same action sequence gives identical snapshots (compared by hash, clones included) | `game.test.ts` |
| The result does not depend on the order rows are requested: each row has its own PRNG stream and depends only on `(seed, z, previous row)` | `worldgen.test.ts`, `game.test.ts` |
| `src/` uses no `Math.random`, `Date`, `performance`, timers, DOM, `process`/`Buffer`, network, `crypto`, `Intl`, Three.js, Node imports or dynamic import/require; the `tsconfig` also loads no DOM or Node types | `purity.test.ts` |
| Internal units are tiles and tiles/tick; anything an agent reads is in columns and columns/s | `observe.test.ts` |
| An action blocked by a tree is a no-op counted in `invalidMoves` | `game.test.ts` |
| A mover's closed-form position equals upstream's per-frame stepping | `mover.test.ts` |
| Input faster than a hop cannot skip a hazard: pressing forward faster than the hop is the same game as stepping forward | `game.test.ts` |
| Maps are winnable: lily pads and grass stay connected in both directions | `worldgen.test.ts` |
| The observation uses a closed set of keys ([ADR-0005](adr/0005-observation-fairness-rule.md)) | `observe.test.ts` |

## Axes and sign conventions

- `z` is the row index and grows forward. `x` is the column, **exactly as upstream, where screen-left is +x**.
- For agents and humans: `col = −x` (screen-right is +`col`) and `dz = z − player row`. The conversion happens only in `observe()` ([observation-and-prompts.md](observation-and-prompts.md)).
- `hop_left` adds +1 to `x` (`col` −1) and `hop_right` adds −1 (`col` +1), as upstream's `moveWithDirection` does. `hop_forward` adds +1 to `z`.
- Speeds are tiles/tick inside the core and columns/s in everything an agent or human reads.

## Ported rules

Every rule was read from upstream's code; the Upstream column names where. Each constant or branch in `packages/core/src` cites its source in a comment.

### Map

| Rule | Value | Upstream |
|---|---|---|
| Rows 0–4 | **Solid** grass: trees in every column −7..7. The hero can never go back past row 5 | `CrossyGame.ts`: `CrossyGameMap.mapRowToObstacle` |
| Rows 5–9 | Grass with tree walls at \|x\| ≥ 5 and 1–3 random interior trees. `Fill.empty` exists upstream but nothing reads it, so only `solid` differs from `random` | `Row/Grass.ts`: `treeGen` |
| Rows ≥ 10 | Type uniform among grass, "roadtype" and water; "roadtype" becomes rail 25% of the time. Result: grass 1/3, road 1/4, rail 1/12, water 1/3 (tested). Rows below 10 are forced to grass | `CrossyGame.ts`: `CrossyGameMap.newRow` |
| Interior trees | Columns −4..4 except 0; up to `round(2·rand) + 1` trees; p = 0.4 per column. The counter also increments when a lily pad vetoes a tree | `Row/Grass.ts`: `treeGen`, `addObstacle` |
| Road | 1–2 cars (upstream's comment says 3, its code never does), speed 0.02–0.08 tiles/tick, one direction per row, start at −6·dir, spacing 5–8, wrap at ±11 | `Row/Road.ts`: `carGen`, `drive` |
| Car widths | police 2, blue_car 1, blue_truck 3, green 2, orange 2, purple 2, red_truck 3, taxi 2 (bounding box of each `.obj`) | `Node/Car.ts` |
| Water, even rows | 2–3 static lily pads at integer columns, starting at −4 or −3, spacing 2–3. If none lands on a column the previous grass row leaves free, the first pad moves to a free column (winnable map). The next grass row plants no tree on a pad | `Row/Water.ts`: `generateStatic`; `CrossyGameMap.getClearPositionsFromGrass`; `Grass.addObstacle` |
| Water, odd rows | 2–3 logs, speed 0.02–0.07, width 1–4 (models 0–3), spacing 5–8 | `Row/Water.ts`: `generateDynamic`; `Node/Log.ts` |
| Rail | One train per row at **0.8 tiles/tick (48 tiles/s)**, wrap at ±110, 2 or 3 middle cars with 50% each (width 20 or 25) | `Row/RailRoad.ts`; `Node/Train.ts` |
| Signal | On for 180 ticks (3 s) each time the train wraps, off before the first wrap. The train's period is 276 ticks (4.6 s) | `Row/RailRoad.ts`: `ringLight` |

Upstream flips the lamp every 200 ms for 15 toggles. The core models only the 180-tick on window; the renderer alternates the two lamps every 12 ticks (200 ms).

### Player

| Rule | Value | Upstream |
|---|---|---|
| Start | `x = 0`, `z = 8` (`START_ROW`), hero width 0.7 | `GameSettings.ts`: `startingRow`; `GameEngine.ts`: `setupGame` |
| Hop | Two tweens of 0.1 s = **12 ticks**: 75% of the distance in the first, the rest in the second, both ease-out (`Power1.easeOut`, `p·(2−p)`) | `GameSettings.ts`: `BASE_ANIMATION_TIME`; `CrossyPlayer.ts`: `PlayerPositionAnimation` |
| Position during a hop | Hazards use the tweened position (`hero.x`, `hero.z`; the row is `round(z)`). The destination is fixed when the hop starts | `CrossyPlayer.ts` |
| Input during a hop | **Queued** (one slot, the last wins). It starts on the tick the current hop lands, after the landing was checked (D9) | `GameEngine.ts`: `moveWithDirection` |
| Forward and back | `x` is rounded with `Math.round`. Sideways moves add ±1 to `x` without rounding (relevant on logs) | `GameEngine.ts`: `moveWithDirection` |
| Blocking | `treeCollision` truncates the target (`Math.trunc`) and only grass rows block. A blocked hop leaves the hero in place and counts as an invalid move | `CrossyGame.ts`: `CrossyGameMap.treeCollision` |
| Score | `max(⌊z⌋ − 8, 0)`, the furthest row reached, credited when a hop completes. A hero killed mid-hop (by a car) never completes it; a fatal landing on water or rail still counts its row, because the credit comes before that tick's hazards | `GameEngine.ts`, `CrossyPlayer.ts`: `updateScore` at the end of the tween |
| Out of bounds | `x < −5`, `x > 5` or `z < 0`; checked only outside a hop | `GameEngine.ts`: `checkIfUserHasFallenOutOfFrame` (`hero.z < camera.z − 1`, camera z is 1) |

### Hazards

Order inside each tick, as upstream's `Engine.tick`: hop animation, hazards of the hero's row, riding and bounds checks (only when not hopping), then the queued input starts. Every hit zone is `heroWidth/2 + width/2 − 0.1` (= `0.25 + width/2`) with strict inequalities, the same expression and operand order as upstream.

| Hazard | Condition | Upstream |
|---|---|---|
| Car | `round(z)` is the car's row, hero alive and `\|x − car.x\| < 0.25 + width/2`, **even mid-hop**. No check on the tick the car wraps | `Row/Road.ts` |
| Water | Outside a hop and not riding, with `round(z)` on a water row: look for a log or pad with the same half-width (the last overlapping platform wins). None found: drown | `Row/Water.ts` |
| Log or pad | Carries the hero (`x += speed` per tick) until the next command. A pad's half-width is 0.75 | `Row/Water.ts` |
| Train | Only **outside a hop** and not on the tick the train wraps. Lethal zone `\|x − train.x\| < 0.25 + width/2` (10.25 or 12.75), **centred on the train's origin** | `Row/RailRoad.ts` |

## Intentional deviations

| # | Deviation | Reason |
|---|---|---|
| <a id="d1"></a>D1 | The position of cars, logs and trains is a closed-form function of the global tick; every row was "already moving" since tick 0. Upstream starts a row moving when it is generated, triggered by the camera | Same map and same phase for any policy |
| <a id="d2"></a>D2 | One PRNG stream per row, derived from `(seed, z, domain)`. A separate cosmetic domain serves the renderer | Row content independent of generation order |
| <a id="d3"></a>D3 | Rows are generated on demand and memoised in a per-game cache (clones share it). No camera and no pool of 20 rows | The camera is a rendering concern |
| <a id="d4"></a>D4 | A train's initial phase is drawn from [−110, 110). Upstream uses the position its pooled row object had (0 on first use) | Reproducible phase, independent of pool history |
| <a id="d5"></a>D5 | The hop is discretised at 60 Hz (`k/6` of each tween per tick). Upstream uses GSAP real time | Determinism; matches upstream on a 60 Hz display |
| <a id="d6"></a>D6 | A new input during a hop leaves no old tweens competing | Upstream repositions the hero but does not cancel the earlier animations |
| <a id="d7"></a>D7 | No animations, particles, sound, vibration, sinking, or the car "carrying" the body after death | Visual, and only after the end |
| <a id="d8"></a>D8 | Upstream bugs are not reproduced: a `TweenLite` used without an import, `entities[0]` read on a row with no entities | They do not affect the logical gameplay |
| <a id="d9"></a>D9 | An input during a hop goes to a one-slot queue and starts when the hop lands. Upstream (`skipPendingMovement`) teleports the hero to the target **without running any tick** and leaves `moving` set | While `moving` is set water does not drown, and with no ticks cars and trains never check the row, so pressing the arrow quickly crossed rivers and roads. Pressing faster than a hop now gives exactly the trajectory of consecutive hops (equivalence test) |

## Preserved quirks

- A train's lethal zone is symmetric around its origin, but the drawn body is not: it spans roughly origin − 2.4 to origin + 17.4 with two middle cars (derived from the model bounding boxes). The observation therefore reports the lethal zone (`col`, `half_extent`), not the drawing, and the renderer draws the body starting at the origin.
- The lethal window is short: 20.5 tiles at 0.8 tiles/tick is about 26 ticks (0.43 s) for the 20-wide train, 32 ticks (0.53 s) for the 25-wide one. For the narrow train the signal turns on about 2.1 s before the zone reaches the hero's column (hero at column 0) and stays on about 0.5 s after it leaves.
- Cars, logs and pads share one hit half-width formula, and the width is `Math.round` of the model's bounding box. A pad is 0.5 wide in the model and `Math.round(0.5)` is 1 in JavaScript.
- Platforms carry the hero until the next command, so riding a log off the edge ends the game as `out_of_bounds`.
- There is no idle death and no "eagle": upstream does not punish waiting. The benchmark's stall rule (an episode ends after N decisions without a new row) is an episode rule outside the core.

## API

```ts
const game = new Game({ seed: 1042 });        // uint32: same seed, same map and traffic
game.step("hop_forward");                      // apply the action, then advance DECISION_TICKS (12, one hop)
game.act("hop_left"); game.advance(5);         // finer control (real time, injected latency)
game.act("hop_forward");                       // returns "queued" while a hop is in the air
const obs = observe(game, { behind: 3, ahead: 8 });  // physical facts only (ADR-0005); these are the defaults
const snap = game.snapshot();                  // plain data for rendering and hashing (default window: 12 rows behind, 24 ahead)
const future = game.clone();                   // cheap copy for look-ahead; rows are immutable and shared
hashValue(snap);                               // determinism comparisons
```

| Member | Meaning |
|---|---|
| `act(action)` | Applies an input now without advancing time. Returns a `MoveOutcome`: `hop`, `queued`, `blocked`, `stay` or `ignored` (the game has ended) |
| `advance(n)` | Runs `n` ticks; stops early on death |
| `step(action, ticks = DECISION_TICKS)` | `act` followed by `advance`; returns a `StepResult` |
| `score`, `alive`, `deathCause`, `invalidMoves`, `tick` | State. `deathCause` is `car`, `water`, `train` or `out_of_bounds` |
| `createRng(seed, stream, domain)` | The only source of randomness |

`@ccr/core/testing` exports `rowsGenerator`, `carAt`, `logAt`, `padAt`, `trainAt`, `roadRow` and friends to build tiny hand-made worlds, and `GameOptions.generator` swaps the seeded generator for them. For measured results of the baselines on these rules, run `pnpm bench` ([benchmark.md](benchmark.md), [results.md](results.md)).

## Changing a rule

1. Read the upstream file and cite it in a comment next to the constant or branch.
2. Preserve its quirks unless a deliberate deviation is listed here; if you add one, add a row to **Intentional deviations**.
3. Add a test that fails without the rule.
4. Update the **Ported rules** tables on this page.

## Open questions

- **Decision length.** `DECISION_TICKS` is 12 (one full hop) in `Game.step`, the runner, the benchmark (`--decision-ticks`) and the app. No documented experiment compares other lengths.
- **Observation window.** `observe()` defaults to 3 rows behind and 8 ahead (12 rows including the player's) and the runner accepts an `observeWindow` override. Trimming it was rejected because a player sees the whole screen ([ADR-0009](adr/0009-perception-memory-judgement.md)); no documented experiment compares other sizes.
- **Train body versus hit zone.** The body extents come from model bounding boxes. The renderer draws the body from the origin toward +x, the direction the train moves, so the body would reach the hero before the lethal zone does and the zone would outlast the body. Whether this matches what upstream shows on screen has not been checked.
