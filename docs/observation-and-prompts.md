# Observation and prompts

What the model is shown for each decision: the fairness rule that limits it, the observation schema, the encoders built on it, the decision strategies, the prompt styles and how to inspect the exact request.

## Fairness rule

The `Observation` holds measured physical facts only, so model conditions start from a common input contract ([ADR-0005](adr/0005-observation-fairness-rule.md)). Encoders, selection rules and controllers add different levels of help; reports identify them separately.

| Allowed | Forbidden |
|---|---|
| Terrain type of each row (grass, road, rail, water) | Labels such as "safe", "dangerous", "collision imminent" |
| Position, half-width and speed (columns per second) of vehicles, platforms and trains | A list of valid or blocked moves computed by the code |
| Columns occupied by trees | Time until a collision with the player |
| The rail warning light (`on` / `off`) | Any field that depends on a candidate action |
| The player's column, the row type under it, whether it rides a platform | The decision of an earlier policy |

Trees are occupied columns (geometry), not "blocked moves". A move into a tree is a no-op in the core and counts in the invalid-moves metric. A test (`OBSERVATION_KEYS` in `packages/core/src/observe.ts`) pins the closed set of keys. Changing the *representation* (JSON, grid, image, relative columns) is allowed, but a report treats it as its own condition.

**Beyond the `Observation`** ([ADR-0009](adr/0009-perception-memory-judgement.md)). A player sees the whole screen and remembers the last moves, so the model may too. The test for any new field is whether a person could know it just by looking at the screen and remembering. Every encoder declares one of these levels (`ENCODER_LEVEL`), and reports show it as "Sees" next to each policy:

| Level | What the model gets |
|---|---|
| `now` | The facts at the instant of the decision, in any format |
| `memory` | Plus the last moves and what each did, the rows crossed and how many moves have passed without a new row |
| `forecast` | Plus where each moving object will be 0.2 s from now (one hop): a pure function of the observation, identical for every candidate move |
| `words` | The `forecast` knowledge compared by the code and told as the word for what fills each cell ([ADR-0010](adr/0010-words-rules-maneuver-executor.md)); nothing new about the world |

The memory is not part of the `Observation`: the runner and the app build it (`Memory`: the last 6 moves, the words views list the last 4) and pass it to `decide(obs, memory)`. *Game knowledge* (the rules and how the game is played, identical for every state and free of numbers) may appear in the instructions. *Judgement* ("safe", "dies if", valid moves, time to collision, "reachable") never may. Rules or controllers that the code adds on top of the model's answers are separate conditions; the report labels them (`helpLabel`), for example `words + rules + graph + route executor`.

## Observation (E0, JSON)

Values below are illustrative.

```json
{
  "player": { "col": 0, "standing_on": "grass", "riding": false, "hop_ticks_left": 0 },
  "rows": [
    { "dz": -1, "kind": "grass", "blocked_cols": [] },
    { "dz": 0, "kind": "grass", "blocked_cols": [-1] },
    { "dz": 1, "kind": "road", "vehicles": [{ "col": 0.3, "half_extent": 0.6, "speed_cols_per_s": 3 }] },
    { "dz": 2, "kind": "water", "platforms": [{ "type": "log", "col": 1, "half_extent": 1.5, "speed_cols_per_s": 1 }] },
    { "dz": 3, "kind": "rail", "train": { "col": -40, "half_extent": 4, "speed_cols_per_s": 48 }, "warning_light": "on" }
  ]
}
```

- Rows are an **array** with `dz` relative to the player's row, never object keys, because the service sorts keys ([clef-api.md](clef-api.md)). The window is 3 rows behind and 8 ahead by default.
- `col` is absolute and grows towards the right of the screen. An object hits or carries the chicken when `|player.col − col| < half_extent`. The edge of the world is not a field: the instructions state that the chicken dies past `|col| = 5`.
- Speeds are in columns per second (the core counts per tick internally; the conversion happens when observing). Values are rounded to two decimals.

## Encoders

| ID | Level | What it adds |
|---|---|---|
| `json` (E0) | now | The observation as is |
| `grid` (E1) | now | An ASCII grid of the world columns −6 to +6 with the chicken marked `@`, plus the exact numbers of each row |
| `image` (E2) | now | A top-down 416×384 PNG (13×12 squares of 32 px) drawn only from the observation, with a trail and a direction mark on moving objects; sent as a `data:` URL |
| `json-rel` (E3) | now | The JSON with every column measured from the chicken (`dcol`, `blocked_dcols`); `player.col` stays absolute |
| `view` (E4) | memory | The whole screen as a text map around the chicken (columns −5 to +5), the exact numbers of each object and the memory in sentences |
| `view-fx` (E5) | forecast | `view` plus a second map of the moving objects as they will be in 0.2 s |
| `json-fx` (E6) | forecast | `json-rel` plus each object's column in 0.2 s (`dcol_after`) and the memory as fields (`last_moves`, `rows_crossed`, `moves_since_new_row`) |
| `lanes` (E7) | words | What fills the cells the chicken could land on (`forward.lands_on`, `sideways.left_lands_on`, `chicken.stays_on`...), which way things move, and the memory |
| `moves` (E8) | words | The `lanes` words grouped under the name of each move (`hop_forward.lands_on`, `stay.stands_on`...) so the keys of the state are the words of the options; row type names left out |
| `scene` (E9) | words | The words widened to the whole row and keyed by the route manoeuvres: `cross_ahead`, `detour_left` and `detour_right` (how far the nearest opening is), `wait_here`, `chicken` and the memory |

The words views share a closed vocabulary with no digits. A cell is `empty`, `tree`, `water`, `log`, `lily_pad`, `vehicle`, `train`, `train_coming`, `outside_world` or `unseen`, and the chicken can stand on `empty`, `log` and `lily_pad` only (a rule of the game, not a reading of a state). Distances are `adjacent`, `two_away`, `three_or_more` or `none`. The words say what is there when the hop ends, never what it means for the chicken; tests reject words of judgement.

## Policy ids

`clef:<model>:<encoder>:<strategy>[:<manual>]`, for example `clef:clef-flash:json:choice:full`. The manual defaults to `full`; an unknown part, or a combination listed below as unsupported, is refused when the id is read. `clef` alone means `DEFAULT_CLEF`.

| Part | Values |
|---|---|
| `model` | `clef-flash`, `clef`, `clef-omni` |
| `encoder` | `json`, `json-rel`, `grid`, `image`, `view`, `view-fx`, `json-fx`, `lanes`, `moves`, `scene` |
| `strategy` | `choice`, `critic`, `critic-go`, `maneuver`, `graph`, `graph-maneuver`, `route` |
| `manual` | `full`, `minimal`, `routing`, `rules`, `ordered`, `exclusive`, `lookup` |

Unsupported: `rules` without `lanes`; `ordered` or `exclusive` without `moves`; `route`, `scene` and `lookup` unless all three are used together; `maneuver` outside `lanes`+`rules` and `moves`+`ordered`; `graph` or `graph-maneuver` outside `moves`+`ordered`; `critic` or `critic-go` with `lanes`, `moves` or `scene`.

`DEFAULT_CLEF` is `{ model: "clef-flash", encoder: "scene", strategy: "route", manual: "lookup" }`, that is `clef:clef-flash:scene:route:lookup`. `CLEF_27B_CONFIG` (`apps/desktop/src/policies.ts`) is the same with `model: "clef"`. The app lists these two Clef players; every other condition opens as a `Custom` player from `CCR_PLAYER=clef:...`.

## Decision strategies

| ID | What it does | Allowed with |
|---|---|---|
| `choice` | One `choice` question over the five actions; the model's argmax is the move | Any encoder but `scene` |
| `critic` | Five `noul` questions ("does the chicken die if it does X?") and a selection rule added by the code: the lowest risk, with risks within 0.05 of it tied and broken by a fixed action preference | Not `lanes`, `moves`, `scene` |
| `critic-go` | The same questions with the rule "hop forward unless its risk is above 0.5", then the lowest-risk other action | Not `lanes`, `moves`, `scene` |
| `maneuver` | One `choice` over five manoeuvres (`cross_ahead`, `sidestep_left`, `sidestep_right`, `back_off`, `wait_here`); an executor (`executor.ts`) waits for the cell to clear and hops, and the model is asked again only when the manoeuvre ends or cannot be done | `lanes`+`rules`, `moves`+`ordered` |
| `graph` | Two small `choice` questions in one request: `go` (`go` or `hold`) and `side` (`hop_left`, `hop_right`, `stay`, `hop_back`). The only rule added by the code is routing: `go` is `hop_forward`, `hold` takes the second answer | `moves`+`ordered` |
| `graph-maneuver` | The same two questions about manoeuvres (`go` is `cross_ahead`), with the executor of `maneuver` doing the hopping | `moves`+`ordered` |
| `route` | Three one-field lookups in one request, each with solved examples: `cell` (`stand` or `no_stand`: can the chicken stand on the cell straight ahead), `moving` (`moving` or `still`: do the things of that row move) and `around` (`detour_left`, `detour_right` or `wait_here`). The only rule added by the code is routing: `stand` or `moving` means `cross_ahead`, otherwise `around` decides. The controller in `route.ts` then crosses, or walks the detour | `scene`+`lookup` |

The controller of `route` waits up to 15 steps (3 s) for a gap when crossing. For a detour it walks the way round (back one row if it must, along the row, forward onto a row not yet reached) for at most 12 hops, checking each hop in its own window. The executors never swap the manoeuvre or the side the model chose: they carry it out or hand the decision back with a reason, which the model reads in `memory.last_maneuver`. The hops they make are not model calls and cost nothing ([ADR-0010](adr/0010-words-rules-maneuver-executor.md), [ADR-0011](adr/0011-route-controller-three-lookups.md)).

For `route`, action probabilities in the panel are derived by `fromRoute` from the lookup probabilities: `P(cross) = P(stand) + (1 − P(stand)) × P(moving)`. The remaining mass is split by the `around` answer and mapped to the corresponding action IDs. These bars summarize the routing rule, not a separate model question over the five moves. Controller-only steps have no probabilities.

The benchmark also has scripted references that never call a model: `always-forward`, `random`, `lookahead`, `rule-view`, `rule-view-fx`, `rule-lanes`, `rule-moves` (scripted readers of the same views, a sufficiency test for what a view shows), `exec-cross`, `exec-rules` and `exec-route` (a scripted chooser plus the executor or controller).

## Prompts

- The instruction and option texts live in `packages/agent/src/prompts.ts` (and `route-prompts.ts` for `lookup`). `PROMPT_VERSION` is `p1`. It is part of the cache tag with the encoder, strategy and manual, and each benchmark run records it; a changed text makes cached answers stale.
- A manual describes the physical rules of the world and never says which move is good. Tests keep advice words (`should`, `safest`, `best move`, `you must`, `avoid`) out of the manuals and encoder notes. Each encoder appends a short note that defines its own fields (for example `dcol`).
- Action IDs: `hop_forward`, `hop_back`, `hop_left`, `hop_right`, `stay`. Manoeuvre IDs: `cross_ahead`, `sidestep_left`, `sidestep_right`, `back_off`, `wait_here` (`maneuver`, `graph-maneuver`) and `cross_ahead`, `detour_left`, `detour_right`, `wait_here` (`route`).

| Manual | Style |
|---|---|
| `full` | The game rules in prose and options that say what each move does. Frozen: cached answers depend on the exact text |
| `minimal` | A shorter rules text with the same options. Frozen |
| `routing` | A short question ("Which move does the chicken make now?"), rules without field names and options that say when each move applies, the way the service's documentation writes `criteria` |
| `rules` | `lanes` only. Options cite the fields and words of that view and the condition under which each move is correct |
| `ordered` | `moves` only. One short rule per move about its own entry of the state, tried in a stated order; the first one that is true wins |
| `exclusive` | `moves` only. As `ordered`, but each option also names the cases that rule it out, so exactly one is true |
| `lookup` | `scene` with `route` only. The game text and one lookup per question with solved examples, identical for every state |

`pnpm bench probe-report` shows, for the words conditions, how often the model picks the move an ideal reader of the written rules would pick: obedience to the rules, not skill.

## What the model is sent

A decision has three parts (`ModelInput` in `packages/agent/src/policy.ts`): the `state` (the world through the chosen encoder), the `instructions` of each question, and its `criteria` (the options and the text of each). The app and the benchmark build the request with the same code (`requestFor` in `clef-policy.ts` and `route-policy.ts`).

To see it exactly:

- In the app, press **I** (or "What it read" on the decision card): the state, question, options and answer of each decision.
- On the command line, `pnpm bench show-input --seed 4 --actions hop_forward [--policy <id>]` prints the request for the state reached by those actions. It sends nothing, needs no key and costs nothing; the default policy is `clef`.
