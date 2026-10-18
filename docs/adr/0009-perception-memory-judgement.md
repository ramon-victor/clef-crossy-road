# ADR-0009 · Perception and memory reach the model; judgement does not

- **Status:** accepted · **Date:** 2026-10-14 · **Complements** [ADR-0005](0005-observation-fairness-rule.md)

## Context and problem statement

ADR-0005 requires the `Observation` to hold only measured physical facts of the instant and nothing derived from a candidate move. The rule protects the experiment, but it was read narrowly: **the model saw less than a player sees and knows**. Several conditions that only reformatted the same facts of the instant (JSON, grid, image, relative columns) left Clef-flash no better than "always forward". The limit is therefore restated as **everything a normal player can see and know**: predicting how objects move, seeing alternative paths, noticing being stuck and backing up, with the world moving while the model thinks.

## Considered options

- Keep the narrow reading (facts of the instant only, in any format): leaves nothing to vary, and format-only conditions did not change the model's play
- Allow anything the code can compute, including per-move judgement (safe or dangerous, valid moves, time-to-collision): the code would decide for the model, and the benchmark would measure the code
- Let perception and memory in, keep judgement out

## Decision outcome

Chosen option: the last one, with three categories and one test for any new field: *"would a person playing know this just by looking at the screen and remembering?"*

| | May enter | May not enter |
|---|---|---|
| **Perception** (what is on screen) | The full width and about 8 rows ahead and 3 behind; every object with position, size and velocity; the signal; **where each object will be in 0.2 s** (what the eye sees as motion); columns measured from the chicken | none |
| **Memory** (what the player remembers) | The last moves and what each did ("moved", "a tree blocked it"), the rows crossed, how many moves since a new row was gained | none |
| **Judgement** (what the player concludes) | none | "Safe" or "dangerous", "dies if...", a list of valid moves, time-to-collision, "reachable", any per-move evaluation sent as model input |

**Game knowledge** is a fourth, permitted category: the rules and how to play ("water drowns without a platform", "a tree blocks", "forward applies when the row ahead can be stood on"), **the same for every state and without numbers**. A player knows this before looking at the screen, and it is how Clef's own documentation uses options (`criteria` says when each one applies). Options written this way are a condition of their own (`manual: routing`), labelled in the policy id. Per-move judgements computed from the current state must never enter the model's input. Selection rules over model answers and controllers are separate, labelled help levels ([ADR-0010](0010-words-rules-maneuver-executor.md), [ADR-0011](0011-route-controller-three-lookups.md)).

The 0.2 s forecast is a pure function of the observation (`col + speed × 0.2 s`), **identical for every candidate move and every chicken position**. A test checks that it matches the simulator 12 ticks later (`packages/agent/src/forecast.test.ts`).

Memory does not enter the `Observation`, whose schema stays ADR-0005's. The runner and the app's `Session` build it and pass it as the second argument of `decide(obs, memory)`. Encoders that predate memory ignore it, so their requests and cache entries are unchanged.

### How the benchmark stays honest

- Every encoder declares a **perception level** (`now`, `memory`, `forecast`, and `words` from [ADR-0010](0010-words-rules-maneuver-executor.md)), and `bench report` shows it beside each policy.
- The `json` encoder (level `now`, no memory) stays as the **control** in every comparison, together with `always-forward` and `lookahead`.
- The scripted players `rule-view` and `rule-view-fx` read only what the views show and serve as a **free sufficiency test**: if a simple reader plays well from a view, the view carries enough information. They are references, never models.
- The probe commands (`bench probe-*`) label states with the simulator to score answers; the labels **never** reach the model (a test checks this).
- Any project rule applied to the model's answers (`critic`, "do not repeat the blocked move") is a separate condition and is described as such.

### Consequences

- Good, because the model receives what a player uses, so the result measures what Clef does with it.
- Good, because every condition carries a label: nobody compares `json` with `json-fx` without knowing what differs.
- Bad, because the border between perception and judgement is a human decision; new fields go through the test question above and a forbidden-words test.
- Neutral: what the model receives can be inspected in the app (key **I**) and with `pnpm bench show-input`, which print the request exactly as it is sent.
- Measured effect of these views on play: see [results](../results.md). On their own they did not make Clef play better than "always forward"; [ADR-0010](0010-words-rules-maneuver-executor.md) and [ADR-0011](0011-route-controller-three-lookups.md) add help at labelled levels.

## Platform clock

Added on 2026-10-17: while riding, `scene` reports `chicken.edge_in` as `a_moment` (under 1 s), `soon` (under 2.5 s), `later`, or `not_carried` (stationary). It derives from the current platform's velocity and distance to the world edge, independently of candidate moves. This extends perception beyond the 0.2 s forecast; it is not a per-move safety evaluation and does not change `Observation`. Non-platform requests omit the field. The help label includes `platform clock`, with tests preserving request compatibility elsewhere.
