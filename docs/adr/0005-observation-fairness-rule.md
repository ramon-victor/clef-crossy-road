# ADR-0005 · Observation fairness rule

- **Status:** accepted · **Date:** 2026-10-14

## Context and problem statement

If the observation carried "safe moves" or "time to collision", the benchmark would measure our logic rather than the model. The observation must therefore stay a record of measured physical facts, while what the model reads beyond it is governed separately by [ADR-0009](0009-perception-memory-judgement.md).

## Considered options

- An observation with helper fields (safety labels, a legal-move list, time to collision): rejected, because it would measure our logic.
- An observation limited to measured physical facts, with its keys frozen by a test.
- Letting the observation itself grow with perception and memory fields: rejected, because those belong to the encoders and the runner, which keeps the schema small and auditable.

## Decision outcome

Chosen option: "physical facts only, keys frozen by a test", because the result then measures what the model can do with the state of the game.

- `Observation` contains only measured physical facts: terrain per row, positions (`col`), hit-zone half-extents, velocities in columns per second, the signal phase (`warning_light`) and what is under the player (`standing_on`, `riding`, `hop_ticks_left`).
- It never contains anything that is a function of a candidate action: safety labels, a legal-move list, time to collision with the player. An invalid move becomes a no-op and is counted as a metric (`invalidMoves`).
- The allowed keys are frozen in `OBSERVATION_KEYS` and pinned by `observe.test.ts`, which also rejects key names that classify moves. Any change to the schema updates this ADR and that test first.
- Beyond the `Observation`, [ADR-0009](0009-perception-memory-judgement.md) applies: perception (the whole screen, where objects will be in 0.2 s) and memory (the player's last moves) may be shown, built by the encoders and the runner; judgement (safe, reachable, valid moves, time to collision) is never shown.
- Changing the representation (JSON, grid, image, columns relative to the chicken in `json-rel`) is allowed, but each one is its own condition in the report and declares a perception level. A representation must be a pure function of the observation: `json-rel` only changes the origin of the columns, undoing it returns the observation (tested), and no field depends on an action.
- A rule of ours applied to the model's answers, such as the `critic` and `critic-go` strategies (five risk questions plus our own selection rule), is also a distinct condition and is described as such in the report.

### Consequences

- Good, because the result measures the capability of the model.
- Bad, because raw observations leave more work to the model; see [results](../results.md) and [observation and prompts](../observation-and-prompts.md).
