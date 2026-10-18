# Results

What happened when Cloudflare's Clef models played the game, why, and what is still open. Protocol, commands and policy ids are in [benchmark.md](benchmark.md).

## Summary

- **The environment is deterministic and reproducible.** Comparisons are paired with confidence intervals, and the daily spend ceiling is checked in code ([ADR-0008](adr/0008-daily-budget-free-tier.md)).
- **Zero-shot Clef-flash does not beat `always-forward`.** In every input format tried (JSON, ASCII grid, image, relative columns, the player's view with the whole screen, motion forecast and memory) it plays like "always forward": about 3.7 rows against 3.78. The image input is significantly worse. Clef 27B chose "forward" in every decision of its 40-game run.
- **The information is in the views; the model does not use it.** Scripted readers of the same views make 13.5 to 19.7 rows.
- **A scaffolded condition moves the model.** An earlier words + three-lookups + route-controller revision reached 22.43 rows over 7 games, at stall limit 40. Current gameplay adds the platform clock and longer detours, with stall limit 60; those historical scores do not evaluate the current model player. The 100-seed [gate](benchmark.md#the-gate) is pending.
- **The value of the project** is the environment, an honest negative result, and a base for RL fine-tuning on the deterministic core ([ADR-0006](adr/0006-no-fine-tuning-no-self-host.md)).

## Headline table

Historical runs below used stall limit 40 and the controller versions recorded at the time. Current revisions are described separately below.

| Condition | Games | Rows crossed [95% CI] | Δ vs always-forward [CI] |
|---|---|---|---|
| `random` | 100 | 1.84 [1.61, 2.07] | n/a |
| `always-forward` | 100 | 3.78 [3.38, 4.22] | n/a |
| `lookahead` (4 hops, reads the simulator) | 100 | 44.75 [37.41, 52.28] | n/a |
| Flash, JSON, `choice` | 100 | 3.70 | −0.08 [−0.24, 0.02] |
| Flash, ASCII grid | 100 | 3.67 | −0.11 [−0.53, 0.35] |
| Flash, minimal manual | 100 | 3.71 | −0.07 [−0.22, 0.02] |
| Flash, image | 100 | 3.36 | −0.42 [−0.82, −0.05] (worse) |
| Flash, `json-rel` | 40 | 3.20 | −0.10 [−0.30, 0.00] |
| Flash, `json-fx` (player view) | 100 | 3.73 [3.39, 4.11] | −0.05 [−0.21, 0.08] |
| Clef 27B, JSON | 40 | n/a | 0.00 (always forward) |
| Clef 27B, `json-fx` | 8 | 2.63 | 0.00 |
| Flash, `view-fx` + `routing` | 7 | 1.43 | −1.29 [−2.57, −0.29] (worse) |
| `moves`·`graph-maneuver`·`ordered` | 40 | 10.05 [7.20, 13.32] | +6.75 [3.92, 9.93] |
| `scene`·`route`·`lookup` (earlier controller) | 7 | 22.43 [10.85, 35.71] | +19.71 [8.14, 33.01] |

Differences are paired on the same seeds, so the `always-forward` reference of a smaller run is not 3.78: it is 3.30 on seeds 1 to 40 and 2.72 on the seven seeds of the last row. **In the last two rows a controller does the hopping** (and, in the last, plans the route), so read them against the free references below, not against `always-forward` alone.

Free scripted references (100 seeds, no model, no cost):

| Reference | Reads | Rows [95% CI] |
|---|---|---|
| `exec-cross` | words, always cross, executor only | 6.08 [4.95, 7.31] |
| `rule-view` | text map now | 13.53 [11.39, 15.78] |
| `rule-moves` | `moves` words, rules in order | 17.45 [14.52, 20.52] |
| `rule-view-fx` | text map now and at +0.2 s | 18.63 [15.43, 22.04] |
| `exec-rules` | words, scripted manoeuvres, executor | 18.83 [15.60, 22.26] |
| `rule-lanes` | `lanes` words | 19.71 [16.33, 23.28] |
| `exec-route` | scene words, scripted choice, route controller | 48.3 (median 38), CI not recorded |

## Why

**Water decides the game.** 97% of `always-forward` deaths are drownings. `pnpm bench diagnose` replays every recorded decision on the simulator and scores the model's P(`hop_forward`) against whether hopping forward survives (AUC 0.5 = no information):

| Condition | Decisions | AUC overall | Decisions with water ahead | Forward drowns | AUC in water |
|---|---|---|---|---|---|
| Flash · JSON | 419 | 0.46 | 122 | 96 | 0.63 |
| Flash · JSON, minimal manual | 416 | 0.43 | 121 | 95 | 0.56 |
| Flash · ASCII grid | 503 | 0.61 | 129 | 105 | 0.52 |
| Flash · image | 619 | 0.49 | 138 | 100 | 0.52 |
| Flash · `json-rel` (40 seeds) | 169 | 0.35 | 44 | 39 | 0.54 |
| Clef 27B · JSON | 143 | 0.75 | 54 | 46 | 0.51 |

- With water ahead, hopping forward drowns in 72% to 89% of decisions (landing on a log or lily pad is the only way to survive). Inside water the AUC is 0.51 to 0.63: no model says which hop lands on a platform, the part that needs position and velocity arithmetic.
- The 27B's overall AUC of 0.75 comes from separating terrain types (grass safe, water not). Its P(`hop_forward`) drops on water but stays the largest of the five options, so it still hops.
- Road and rail have 0 to 9 fatal hops per condition, so their AUCs are noise.
- On the 90-state probe, choosing a move that drowns in the 24 deadly-water states happens 96% of the time for Flash (`json`, `json-fx`) and 71% for the 27B, the only model that moves (about 30 neurons per decision). `clef-omni` with a picture changes nothing.
- A first sample of 12 hand-written scenarios (preliminary) showed the same: Flash chose `hop_forward` in 12 of 12, as `always-forward` does.
- Scripted readers of the same views (table above) make 13.5 rows from the map now and 18.6 with the 0.2 s forecast, 3.6x to 4.9x the floor. The information is in the view.

## Four durable findings

1. **Terrain type is read; kinematics are not.** The models separate grass from water from road, not a log that will arrive from one that will not. The 27B gave a road, water or rail row ahead a risk of 0.42 to 0.65 whether the vehicle was far, receding or imminent (12 scenarios, preliminary).
2. **The option text decides more than the state does.** Rewriting options as "when each move applies" (`routing`) moved Flash on the probe from 82 of 90 choices forward to 16 (56 left, 12 wait, 6 right). Fatal choices in deadly water fell from 96% to 33% (`json-fx`) and 13% (`view-fx`), but the AUC in water stayed at 0.56 to 0.63 and open states were refused as well (good move in open water 42% and 33%). In games, `view-fx` + `routing` chose `stay` 143 times in 220 decisions, 43% stalled, and made 1.43 rows.
3. **Words plus one-field lookups with solved examples give the model something it can do.** The code compares and says what is where (closed vocabulary, no digits, no verdicts). Agreement with the ideal follower of the written rules on the 90-state probe was 37% to 66% for the earlier word conditions, 86% and 85% for two-question versions, and **94%** for three one-field lookups (`cell`, `moving`, `around`) with solved examples. A two-field rule had been read as one: still water came out as "passing" in 12 of 12 such states. Agreement measures obedience, not skill. Separating open from deadly states was already near-perfect (AUC 1.00) with `moves` + `ordered`, while following the rules as a program was not.
4. **A route-walking controller cuts stagnation.** 23 of 40 games (58%) of the previous condition ended stalled, nearly all repeating one manoeuvre 30 to 40 times, and 7 of the 23 needed to step back a row, which no one-step manoeuvre does. With the controller 2 of 7 games stalled (29%), and the free ceiling rose from 18.83 (`exec-rules`) to 48.3 (`exec-route`) rows. Lateral reach alone barely helped (18.8 to 19.7); stepping back a row and aiming at the frontier row did. The free `exec-route` still stalls in 59% of games, but at high rows, in dead ends.

## Other conditions and probes

Probe: 90 labelled states; "fatal" is the share of the 24 deadly-water states where the chosen move drowns the chicken; "agrees" is agreement with the ideal follower of the written rules. Intermediate wordings of the word conditions cannot be reproduced with the current code and are not listed. See [observation-and-prompts.md](observation-and-prompts.md) for the encoders.

| Condition | Games | Result | Takeaway |
|---|---|---|---|
| `json` · `critic-go` | 71 | 3.35; Δ 0.00 | Always advances: the risk of advancing never exceeds 50% |
| `json` · `critic` | 4, stopped | 0.00; 4 of 4 stalled | On open grass forward is rated riskier (0.30) than a sidestep (0.05), so `hop_left` always wins |
| `view` | probe | fatal 88% (control 96%) | Text memory barely helps with trees (90% repeat) |
| `view-fx` | probe | fatal 88% | No measurable change from the forecast (control 96%) |
| `clef-omni` · image | probe, 46 states | fatal 100% (n = 6) | No gain demonstrated in this small probe |
| `lanes` · `full` | probe | fatal 42%; agrees 37% | Words instead of numbers: 96% to 42% |
| `lanes` · `rules` | 5 | 3.80 [2.00, 6.60]; 100% drowned; probe fatal 8%, agrees 52% | Options naming the fields help the probe, not the game |
| `lanes` · `maneuver` · `rules` | 5 | 3.40 [1.40, 5.40]; 60% stalled | An executor without a route stalls |
| `moves` · `exclusive` | probe | fatal 8% (50% in open water); agrees 40% | Worse than ordered options in open water |
| `moves` · `ordered` | 10 | 4.00 [2.60, 5.70]; probe fatal 0%, agrees 57% | Clean probe once the word `water` left the state's row field; play stays near the floor |
| `moves` · `graph` | 10 | 6.10 [3.70, 8.60]; probe fatal 0%, agrees 60% | Two small questions replace one of five options; 30% stalled |
| Clef 27B · `moves` · `ordered` | probe | fatal 0%; agrees 66% | +3 points of good moves over Flash [−8, 14] at 6.3x the cost |

Design influences are listed in [references.md](references.md#related-work). Listing legal moves with their consequences is excluded by [ADR-0009](adr/0009-perception-memory-judgement.md).

## Controller versus model

The controller does the hopping, picks the instant and walks the detour. Historically the model chose crossing, a detour or waiting. Current gameplay also asks when to leave a platform and, if a maneuver cannot start, tries other detours in the model's probability order. Both versions require labelled comparisons ([ADR-0011](adr/0011-route-controller-three-lookups.md)).

| Reference (100 seeds) | Rows | What it isolates |
|---|---|---|
| `always-forward` | 3.78 | No reading, no help |
| `exec-cross` | 6.08 | The executor alone (+2.30 [1.17, 3.53]); 46% stall |
| `exec-rules` | 18.83 | Scripted manoeuvre choice with that executor |
| `exec-route` | 48.3 | Scripted choice with the route controller. Deaths: car 17%, edge 7%, train 2%, drowned 0%; 59% stall (dead ends at high rows); 15% reach the 300-decision cap |
| `lookahead` | 44.75 | The simulator |

The 22.43-row mean covers 7 games and is not paired with `exec-route` or `exec-cross`; both are free, so the matched numbers on seeds 2 to 8 need only a free `pnpm bench run` and `report`. The earlier 40-game condition reached a little over half of what scripted readers of its words make (10.05 against 17 to 20) and beat the executor alone by 4.80 rows. Matched-seed comparisons with both the executor-only floor and the scripted chooser are needed to attribute gains; a comparison against `always-forward` alone cannot isolate the model's contribution.

## Current controller revision

The 2026-10-17 revision adds the platform clock, a fourth lookup while riding, expiring failed-side memory, longer detours and immediate refusal of still water. These are controller and prompt changes, not evidence that the original model learned to play.

| Scripted reference | Seeds | Mean rows | Stall limit |
|---|---|---|---|
| `exec-route`, revised controller | 100 | 57.6 | 40 |
| `exec-route`, revised controller | 100 | 61.6 | 60 (current default) |

No paired interval was recorded for this revision. With limit 60, 24 games stalled, including 6 facing still water; deaths were car 20, edge 17 and train 3. These counts belong to the scripted reference, not Clef-flash.

On the platform probe, asking whether `edge_in` equals `a_moment` produced `leaving` in 12 of 12 near-edge states and 0 of 12 other platform states; asking in general language whether the platform would carry the chicken out produced 3 of 12. This is a small rule-following probe, not a gameplay evaluation.

Recorded Clef-flash replays on seeds 6 and 7 still end at 9 and 8 rows. Seed 8 rose from 39 to 115 rows within the 300-decision benchmark cap, or 183 when recorded to completion (671 decisions, `--max-decisions 1000`). Its 31 refused maneuvers pass to other model-ranked detours without a new request. The three complete replays have 272 cache hits and no new calls in the recorded validation. Do not combine that uncapped game with the historical seven-game benchmark mean.

The updated controller and model still need a matched-seed evaluation. The formal 100-seed gate remains pending.

## Latency finding

These runs cover scripted references only, on 100 seeds; no model condition was run under injected latency. The serial and pipelined methods are defined in [benchmark.md](benchmark.md#latency-injection). Scores are mean rows crossed:

| Policy | none | 300 ms serial | 300 ms pipelined | 800 ms serial | 800 ms pipelined |
|---|---|---|---|---|---|
| `always-forward` | 3.78 | 3.32 | 3.57 | 3.37 | 3.39 |
| `lookahead` (plans from the stale state) | 44.75 | 6.48 | 11.70 | 4.25 | 4.60 |
| `lookahead-comp:<ms>` (plans from the forecast state) | n/a | 11.92 | 20.52 | 7.35 | 8.64 |

A Clef-flash round trip measured from Brazil is p50 about 326 ms with a small prompt sequentially and about 930 ms with 4 to 6 requests in parallel ([measurements](clef-api.md#latency)).

- An exact planner falls from 44.75 rows to 6.48 at 300 ms serial and 11.70 pipelined; at 800 ms pipelined it makes 4.60. Planning from the forecast state recovers part: 20.52 at 300 ms pipelined, 8.64 at 800 ms.
- Two effects: **stale information** (the plan comes from a state that has moved; compensation helps) and **exposure** (the chicken idles on a road, rail or log while waiting; only pipelining helps).
- Even an exact, compensated planner loses more than half its score at 300 ms and about four fifths at 800 ms. Any expectation of real-time play starts here, which is why the gate uses step-by-step play.

## Limits and honesty

- The last row of the historical table is **7 games** (interval [10.85, 35.71], games from 4 to 51 rows). Seeds 2 to 5 used a controller without `canSettle`, seeds 6 to 8 used the then-current revision. The scripted controller averaged 48.3 rows after that change versus 47.5 before it; no paired interval was recorded. Current cached seeds 6 to 8 include later controller changes, so they no longer reproduce that historical sample as a whole.
- The condition is the whole stack and is not evidence that the model plays zero-shot. Zero-shot results are the first rows of the headline table.
- **The gate is pending.** It needs at least 100 seeds; the only intervals above zero come from 40 and 7 games.
- One prompt text per condition (plus a minimal variant). The 27B JSON run records no mean; the `exec-route` interval is not recorded.
- Probe cells hold 6 to 36 states, so their intervals are wide; probes measure separation and rule-following, not play skill.
- Hosted models can change without notice. All runs were made in October 2026.

## Open work

- **Run the current default on 100 seeds** (`clef:clef-flash:scene:route:lookup`) against `exec-route` with matching limits and controller version. The earlier three-question estimate was 25,000 to 30,000 neurons across several days; the fourth lookup and longer games require a fresh `pnpm bench plan`. Keep the call cap in mind (`--max-calls` does not stop games in flight). The 27B on the same seeds only if it fits.
- **RL fine-tuning** with the core as environment ([ADR-0006](adr/0006-no-fine-tuning-no-self-host.md)). The diagnostic names the target: reading position and velocity to land on logs and lily pads. It needs Cloudflare's RL program or self-hosted open weights (Apache 2.0). `pnpm bench export` already writes (observation, action, reward, done) trajectories with physical facts only.
- **`clef-omni` with images** on 25 to 40 seeds (about 80 neurons per seed, so 2,000 to 3,200), to complete the model matrix. The 46-state probe suggests no change.
- **Probability-threshold veto** (refuse hops when P(`hop_forward`) is low). It should only help stop at the water's edge. A threshold rule replayed over recorded answers of the word conditions did not beat the argmax.
- **Confidence abstention** as an ablation over stored answers (no API call).

## Open questions

- How much of the default condition's score is the model? No matched-seed comparison with `exec-cross` or `exec-route` exists for the 7 games.
- Does the default condition pass the gate at 100 seeds? The 7-game interval is wide.
- Does the model hold up under real-time latency with the controller reading the live world?
- Why does the model ignore a platform given as numbers but use it when it is told in words? The data show the effect, not the mechanism.
- Does the 27B add anything on the default condition? Only Flash was played, and the 27B costs 6.3x.
