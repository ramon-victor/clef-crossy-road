# ADR-0013 · The model times the hop: `route-live`

- **Status:** accepted · **Date:** 2026-10-20 · **Amends** [ADR-0011](0011-route-controller-three-lookups.md) and [ADR-0012](0012-clef-decides-to-step-off-no-rescue.md)

## Context and problem statement

After ADR-0012 the controller still decided two things for Clef at every crossing (`RouteExecutor.crossStep`). It **checked the landing itself** and, even when Clef had answered `stand`, held the hop back if the chicken could neither stay on the landing row nor go on from it (`canSettle`), a fact the model never sees. And it **waited alone** for the gap, up to 15 steps, without asking. A wrong `cell` answer could cost time, never the chicken, and the moment of every hop was the controller's.

The open-source Jev game projects mostly give that moment to the model (see [references](../references.md#who-times-the-action-read-2026-10-20-readmes-and-key-files-not-every-file)): `mario-jev` asks `start_jump` at every decision, pauses the emulator while it answers and "adds no scripted hazard override". The owner asked for the same freedom, without taking information away from Clef.

## Considered options

- Keep the checked hop (`route`), which is the best score and the least honest
- Let Clef time the hop with the information it already reads (`route-live`)
- Let Clef time the hop and add a word for what the old check looked at (a second lookup, with the code joining the answers)
- Also hand every hop of a detour to Clef (the route-less conditions of ADR-0010 stalled and tied "always forward")

## Decision outcome

Chosen option: `route-live`, `scene` view, same `lookup` questions, same words. Measured first, with the free scripted chooser answering the same lookups, on seeds 1 to 100 (stall limit 60, cap 300 decisions):

| Chooser | Rows | Consultations / distinct requests per game |
|---|---|---|
| `exec-route`: controller checks the hop and waits (what `route` does) | 65.36 | - |
| live, `cell` reads the word Clef reads today (`lands_on`) | **68.14** | 195 / 145 |
| live, `cell` reads a longer dwell window | 55.26 | 207 / 145 |
| live, the old check's lookahead folded into the word | 65.32 | 197 / 146 |

The last row reproduces the checked controller (65.32 against 65.36), which shows the mechanism is the same; the first live row shows that the hidden check was not needed for the ideal chooser's ceiling. So no new word, no new question and no extra tokens.

- **Every decision asks again.** `cross_ahead` is a hop **at once, with nothing checked**: not the landing, not the rest, not a tree or still water ahead. `things pass` (`cell` is `no_stand`, `moving` is `moving`) is `wait_gap`: one step of staying, then the next decision asks again. There is no waiting limit of its own; the stall limit (60 decisions without a new row) ends a game that waits forever.
- **The controller keeps the "how".** Detours still walk a route (the model picks the side), `step_off` still takes the hop off a cell Clef called untenable, `leave_platform` still finds the way off. A wait on a cell that cannot hold the chicken, or on a platform that carries it off, is a `hold` that says nobody stepped in (ADR-0012).
- **`route` stays** as the assisted control, reachable as `clef:clef-flash:scene:route:lookup`, and `exec-route` / `exec-route-live` are the free references. The questions are the same text, so a request both strategies can make is one cache entry.
- **The probability bars follow the new meaning:** the hop gets P(stand), what passes is a step of waiting, and the rest is split by `around`.
- **The app skips the reading pause for a second wait in a row** (the model is asked again every 0.2 s of game time and would stop the game at each answer), and folds a run of the model's own waits into one chip.

### Evidence from the model

- **Probe** (114 labelled states, 882 neurons): 92% agreement with the ideal follower on the 90 states with a gabarit (earlier three-lookup design: 94%); platform near the edge 12 of 12 `leaving`, far 12 of 12 `staying`; `here` was right in all 114 (3 `move_off`, exactly the 3 states with a warned train under the chicken). AUC of P(hop forward) 0.92 on water and on road.
- **One game, seed 624140:** 19 rows, drowned at decision 62. The last decision answered `cell: stand` with P(stand) = 0.56 on a moving water row and hopped. 51 requests, 32 paid and 19 from the cache of `route`, 246 neurons. The same map with `route` reached row 100 or more in the owner's run, with the controller checking each hop. This is not a matched comparison (one seed, a different controller) and says that the freedom has a price, not how large it is.

### Consequences

- Good, because a wrong `cell` answer now kills the chicken, so the score is Clef's and the labels say who hopped (`decidedBy` credits every live hop and wait to the model).
- Bad, because the score falls and the cost rises: about 195 consultations in a 65-row game of the ideal chooser (145 distinct requests, which the cache makes free the second time), around 1,100 to 1,500 neurons for the first such game at the measured 7.75 neurons per request. About four long games fit in a free day. The 100-seed gate would need roughly 150,000 neurons at this level, so it is not planned.
- Open: a decision rule over the probabilities (hop only if P(stand) is high enough; `mario-jev` thresholds its yes/no answers), a matched-seed comparison with `route` on a few seeds as the budget allows, and whether the `memory` field, which no question reads and which keeps most requests distinct, should stay in the state.
