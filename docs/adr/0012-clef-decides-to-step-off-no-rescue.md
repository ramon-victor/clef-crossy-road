# ADR-0012 · Clef decides to step off its cell; nothing steps in when it is wrong

- **Status:** accepted · **Date:** 2026-10-20 · **Amends** [ADR-0011](0011-route-controller-three-lookups.md)

## Context and problem statement

Watching the app, a chicken standing on a rail stepped back when a train came, and nothing on screen said whether Clef or the game code had decided that. Reading the code showed it was the code. Clef was asked only whether to cross, which way to go round and (on a platform) whether the edge was a moment away. The step back came from `safeHold` in `route.ts`: any manoeuvre that was refused, or `wait_here`, ran an escape search and moved the chicken off a cell that could not hold it, **whatever Clef had answered**. The same hold also saved a chicken carried towards the edge of the map by a platform Clef had said it could stay on.

Two problems followed. The help was larger than the labels said: the most critical decision of the game, getting out of the way of a vehicle or train, belonged to the controller. And the screen credited it to Clef: the first move of every consultation was stamped `source: "model"`, drawn as "the model's own move" in the history strip, and shown beside "Clef chose: Go straight".

## Considered options

- Only label the controller's escapes (the bench, the prompts and the cached maps stay as they are)
- Label them and add a question, keeping the rescue as a labelled safety net under Clef's answer
- Label them, add the question and remove the rescue

## Decision outcome

Chosen option: label, add the question and **remove the rescue**. The owner's rule is that a model that is wrong should pay for it: the score is Clef's, and a net would hide how often it missed the danger.

- **A fifth lookup, `here`, asked in every request.** `Can the chicken stay on the cell it stands on?`, options `remain` / `move_off`, reading only `wait_here.stands_on` (what is under the chicken over the next 0.4 s, already in the state; the state does not change). It is solved by examples like `cell` (`vehicle`, `train`, `train_coming`, `water` and `outside_world` mean `move_off`; `empty`, `log` and `lily_pad` mean `remain`). It is asked even when nothing is wrong, because asking it only in danger would itself be a hint ([ADR-0009](0009-perception-memory-judgement.md)). The text has no "safe", "unsafe" or "danger".
- **A manoeuvre, `step_off`.** `move_off` selects it, after `leave_platform` and before the crossing and the detours. The controller takes one hop to the nearest cell that can hold the chicken (`searchEscape`, 4 hops) and the model is asked again from where it lands. If the cell under the chicken can already hold it, or no cell is within reach, the manoeuvre is refused and the chicken waits where it is.
- **`safeHold` no longer moves the chicken.** A refusal or `wait_here` keeps the chicken where it is, and the step is recorded as `hold` with `why: "refused"` (a cell that holds it), `"exposed"` (a cell that cannot hold it) or `"edge"` (a platform carrying it off the map). The edge fallback goes with it: leaving a drifting platform is Clef's `ride` answer or nothing. `leave_platform` and `step_off`, once Clef chooses them, are still carried out by the controller (it finds the hops).
- **The scripted chooser answers the new question by code.** `routeChoice` returns `step_off` when `wait_here.stands_on` cannot be stood on, so the free `exec-route` reference stays "the ideal follower of the lookup rules" with no hidden net.
- **Who moved is data.** `decidedBy(decision)` in `packages/agent` returns `"model"` for the move a consultation ends in (including `step_off` and `leave_platform`, where the model said the chicken goes and the controller only found the hop) and `"controller"` for later steps of a manoeuvre, a hold that stands in for a refused pick, and a manoeuvre begun in place of the one Clef chose. `Decision.source` is unchanged (the session uses it to open turns). The strip, the caption, the execution list and the "game controller" note read `decidedBy`; a chicken left on a cell it cannot hold, or on a platform that carries it off, shows "Nothing stepped in" instead of a move.

### Consequences

- Good, because the dodge is Clef's, the screen says who moved, and a missed dodge is visible as such (`hold` / `exposed`) in the panel, the records and any report.
- Good, because the scripted ceiling did not move: `exec-route` made 65.36 rows over seeds 1 to 100 after the change and 64.58 before it (two free runs on the same seeds and machine; see [results](../results.md)).
- Bad, because every Clef request grows by about 335 tokens (the `here` question): the one recorded game read 2,242 input tokens per call against the 1,650 estimated for three lookups. Cost per decision rises by about a third.
- Bad, because every cached Clef answer is stale. Seed 7 was recorded again (19 requests, 147 neurons) and replays from the cache with zero calls; no other map is listed as free.
- Bad, because the numbers published for Clef (22.4 rows over seven games) belong to the previous controller and prompts. No model result exists for this revision beyond one game, in which Clef answered `move_off` correctly on every later decision and still died: `step_off` found no cell within 4 hops and the chicken stayed on a road row.
- Open: whether 4 hops is enough reach for `step_off` (the ceiling dies to cars in 22% of its games), and whether the model's `here` answers hold over 100 seeds.
