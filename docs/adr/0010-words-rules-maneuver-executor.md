# ADR-0010 · Words, rules in the options and a maneuver executor: labelled help levels

- **Status:** accepted · **Date:** 2026-10-15 · **Complements** [ADR-0009](0009-perception-memory-judgement.md)

## Context and problem statement

After twelve conditions Clef-flash still played like "always forward", although scripted readers of the same views crossed far more rows ([results](../results.md)). The information was in the view; the model did not use it. The next step reworks the gameplay around patterns that recur in other projects that drive a decision model through a similar API (`choice` and `noul` questions with probabilities). Patterns only; no code from these projects is used; see [references](../references.md).

**Design influences**

1. Small state, in words or ready-made fields: the code subtracts, orders and classifies, and the model receives the relation, not a calculation.
2. The option text carries the rule: each option states its boundary, not only its purpose.
3. The model picks the maneuver; code executes it and handles the timing.
4. A stale answer is worth little: discard or replan on arrival, read the world live, forecast instead of using the current position.
5. Several small questions per call add little latency.
6. Abstention and honest labels: low confidence becomes a visible fallback, and whatever is not the model says so.
7. Memory goes in the state, because every call starts from scratch.

## Considered options

- Keep reformatting the facts of the instant (JSON, grid, image, relative columns) or add only perception, forecast and memory ([ADR-0009](0009-perception-memory-judgement.md)): tried; kept as controls
- Words only: the code compares, the model reads the word for what fills each cell
- Words plus rules written into the options
- Plus small exclusive questions in one call, and plus an executor that does the hopping
- Helping without saying so, or replacing the model's choice silently: rejected; every level is labelled

## Decision outcome

Chosen option: help in **levels, all labelled** in the policy id and in every report (`helpLabel`, column "Sees"). The earlier levels stay as controls.

| Level | What enters | Id |
|---|---|---|
| control | the facts of the instant, in any format | `json` |
| perception | the whole screen, where things will be in 0.2 s, the last moves ([ADR-0009](0009-perception-memory-judgement.md)) | `view`, `view-fx`, `json-fx` |
| **words** | the same knowledge, **already compared by the code** and said as the word for what fills each cell where a hop lands | encoders `lanes` (by place), `moves` (under each move's name) |
| **words + rules** | options that cite the fields and words and say when each move is right, the same for every state | `lanes` + manual `rules`; `moves` + manual `ordered` or `exclusive` |
| **+ small questions** | two exclusive questions in one call instead of five options; the only project code is the routing (`go` is forward, `hold` is the second answer) | `moves` + `ordered` + strategy `graph` |
| **+ executor** | the model picks the maneuver, the code picks the moment and hops | `maneuver` (`lanes`+`rules` or `moves`+`ordered`), `graph-maneuver` (`moves`+`ordered`) |

[ADR-0011](0011-route-controller-three-lookups.md) adds the next level, a route controller.

**Words (`lanes`, `moves`).** A closed vocabulary (`empty, tree, water, log, lily_pad, vehicle, train, train_coming, outside_world, unseen`), no digits, and no field that evaluates what a cell means for the chicken. It says what **is** in the cell when the hop ends (the ADR-0009 forecast), never whether that is good. The line is: *what fills a cell* is perception; *"the chicken can stand on empty, log and lily_pad"* is a **rule of the game** (in the manual, the same for every state, like "water drowns"); *"hopping forward is safe"* is **judgement, forbidden**. Per-word semantics and look-ahead windows are in [observation and prompts](../observation-and-prompts.md).

**Rules (`rules`).** The option text names fields and words ("Correct when forward.lands_on is empty, log or lily_pad") and gives a checking order. This **measures whether the model applies a written policy to words**, not whether it discovers one: it is instruction-following, and reports call it that. A test checks that every field cited in the options exists in the state and that the text contains no "safe", "danger" or "you should".

**Executor.** The model answers `cross_ahead`, `sidestep_left`, `sidestep_right`, `back_off` or `wait_here`. Every step (0.2 s) the code reads the live world, with the same words, waits for the target cell to become standable and hops. It **never swaps the model's maneuver**. It gives the decision back, with the reason, when the cell is permanent (a tree), when the chicken cannot stay where it stands, when a platform is carrying it to the edge, or after 15 steps (3 s) of waiting; the model hears how the previous maneuver ended (`memory.last_maneuver`). Executor steps are **not model calls** (0 neurons, `source: "executor"` in the record and the log). Because the executor decides the moment, which is much of the skill:

- the maneuver rule says to leave a spot the chicken cannot hold before waiting for a gap;
- every comparison carries the free references **`exec-cross`** (always cross, same executor, no model: what the executor does alone), **`exec-rules`** (a scripted chooser following the maneuver rules: the ceiling) and **`rule-lanes`** (a scripted reader of the words, per hop);
- if Clef does not beat `exec-cross` on the same seeds, the report states that no improvement over the executor-only floor was demonstrated.

**Honesty rules.** Each condition states its level; `json`, `json-fx` and `routing` remain as controls, with the same caches and prompt hashes (a test freezes `full` and `minimal`). Scripted references are never models; they only show whether a view carries enough information, at no cost. Negative results are recorded in [results](../results.md).

### Consequences

- Good, because it tests the hypothesis from those projects: the model follows the text of the options and reads words, not position-and-velocity arithmetic.
- Good, because the executor reads the live world between model calls and reduces calls; whether this preserves model performance under real-time latency remains untested.
- Bad, because "words + rules" puts the policy in the prompt (an experiment on obedience) and the executor puts the timing in code; hence the labels, the references and `exec-cross`.
- Bad, because `stallLimit` and `maxDecisions` count steps, including the executor's waiting steps (the rule is the same for every policy).
