# ADR-0011 · Route controller, scene view and three lookups: the "assisted navigation" level

- **Status:** accepted · **Date:** 2026-10-15 · **Complements** [ADR-0010](0010-words-rules-maneuver-executor.md)

## Context and problem statement

The ADR-0010 condition (`graph-maneuver`) often stalled. Replaying the recorded games and the simulator (free, nothing new recorded) showed three causes: a stalled game usually ended in **one maneuver repeated dozens of times** (`wait_here`, or a refused `sidestep_*` chosen again); the model did not apply the composite rule of the forward question (two conditions in one option); and some positions, such as a chicken **surrounded by trees**, need a multi-step exit (back one row, slide, forward twice) that no one-step maneuver makes. Other projects that drive a decision model leave the **path** to code: the model picks a destination or a side, and code finds the route ([ADR-0010](0010-words-rules-maneuver-executor.md), design influences).

## Considered options

- Keep the one-step maneuvers and refine the prompts: loops persist, and no one-step maneuver makes a multi-step exit
- Make the model chain the steps of a detour itself (back, right, right, forward, forward): several decisions, each of which can go wrong
- Keep a two-field composite rule in one question: the model read it as a single field (still water came out as "passing")
- A scene view, one-field lookups with solved examples, and a controller that walks detours

## Decision outcome

Chosen option: a labelled route-controller condition. The current help label is `words + rules + graph + platform clock + route executor` (`helpLabel`). All code is in `packages/agent/src`. The original three-question design is summarized here; the 2026-10-17 changes are recorded below.

| Part | What it is | Where |
|---|---|---|
| **`scene` view** | The `lanes`/`moves` words widened to the whole row. For each side: how far the nearest opening in the row ahead is (`adjacent`, `two_away`, `three_or_more`, `none`); how many cells of its own row the chicken could step on (`blocked_at_once`, `free_for_one`, `free_for_two_or_more`); whether it stands behind the furthest row reached (`behind_frontier`); whether the controller already gave that detour back (`recently_failed`). Closed vocabulary, no digits, **no "reachable" and no "safe"**: it says what is where | `scene.ts` |
| **`lookup` manual** | **Three questions, one lookup each, with solved examples**: `cell` (can the chicken stand on the cell ahead?), `moving` (do the things of that row move?) and `around` (which side to go round by?). `cell` and `moving` each read a single field (`cross_ahead.lands_on`, `cross_ahead.things_move`); `around` compares the `opening_ahead` of the two sides, with `recently_failed` and `chicken.place_in_world` as tie-breakers | `route-prompts.ts` |
| **Routing** | The only project code over the answers: a cell to stand on, or things that keep passing, means `cross_ahead`; a cell that cannot be stood on with nothing moving means the way is closed, and the third answer decides (left, right or wait) | `route-policy.ts` |
| **Detour controller** | `cross_ahead` waits for the gap and hops. `detour_left` and `detour_right` **walk the route**: a breadth-first search over the same words (depth 8 hops), redone every 0.2 s on the live world, going back one row if needed, sliding along the row, then forward onto a row not yet reached. Each hop is checked in its **own window** (a vehicle counts from 0.05 s into the hop that brings the chicken onto its row; water and rail only on landing), with drift on logs and an edge margin. It **never swaps the side the model chose** and gives the decision back with the reason (no route, 12 hops, 15 waiting steps, a platform carrying it to the edge). When refusing a maneuver, it tries to hold its current cell or searches up to 4 hops for somewhere to stand. This fallback does not guarantee survival | `route.ts` |

The controller plans the route and code picks the moment: **the model only chooses between crossing, going round by a side, or waiting.** Therefore:

- `DEFAULT_CLEF` (the short policy id `clef`, in the app and the bench) is `clef-flash` with `scene` + `route` + `lookup`; the 27B model plays the same gameplay (`CLEF_27B_CONFIG` in `apps/desktop/src/policies.ts`). The earlier conditions stay as controls and open in the app as `Custom`.
- Reports compare the model with a floor, `exec-cross` (the ADR-0010 executor alone), and a ceiling, `exec-route` (the ideal chooser of the lookup rules with this controller, no model). These references help separate controller and model performance; attribution requires matching seeds and controller versions. If Clef does not beat the floor on the same seeds, no improvement over that floor was demonstrated.
- The agreement with the ideal chooser (`bench probe-report`) measures obedience to the rules, not skill.

Numbers are in [results](../results.md).

## Current controller and platform lookup

The following changes were added on 2026-10-17; the table above describes the original controller:

- On a platform, a fourth lookup asks whether `chicken.edge_in` is `a_moment` (`ride`: `leaving` or `staying`). `leaving` selects `leave_platform` before the scene answers. The controller searches up to 8 hops for an exit; urgent edge handling remains a labelled controller fallback, independently of the model's answer ([ADR-0009](0009-perception-memory-judgement.md#platform-clock)).
- Failed sides expire after 4 decisions. Detours search 24 hops and run up to 40 steps, ending on the selected side. Still water is refused immediately instead of consuming a crossing wait.
- When a maneuver cannot start, the policy tries the other detours in the model's `around` probability order, without a new request. Waiting is already the refusal behavior and is excluded; `wait_here` and `leave_platform` do not enter this queue. `extra.fallback` and typed controller notices distinguish the model's initial answer from the maneuver actually begun.
- The stall limit is now 60. The historical results used 40; compare controller versions and episode limits as well as seeds. Current scripted `exec-route` makes 61.6 rows over 100 seeds; there is no corresponding 100-seed model result.
- A platform request's recorded probabilities include the `leaving` mass on the first actual action. The panel and compass show the selected routing branch, separately from the benchmark's joint distribution. Conversation, notices and localization are presentation metadata and do not enter observations or benchmark trajectories.

### Consequences

- Good, because stalls and loops move out of the model into code, which is reliable at path-finding, and the model is left with small lookups over words.
- Bad, because this is the level with **the most help so far**: the policy (rules), routing, path and timing all come from project code. The result belongs to the whole stack, and reports label it that way. The switch of the default was made on a small number of games; the formal 100-seed gate ([benchmark](../benchmark.md)) is still pending.
- Bad, because **a cached map only replays if the controller makes the same moves as when it was cached.** The requests to the model are the same, but the game trajectory depends on the controller, so changing `route.ts` (or the texts) makes a cached map diverge and spend. After any such change, replay the seeds and check each one with `--daily-neurons 0` (any new request is refused and nothing is spent) before listing it in the app (`CLEF_CACHED_SEEDS`).
- Bad, because `--max-calls` of `bench run` only stops **starting** games: a game in progress runs on, so a run can spend more than planned until the local daily ceiling ([ADR-0008](0008-daily-budget-free-tier.md)) stops it.
