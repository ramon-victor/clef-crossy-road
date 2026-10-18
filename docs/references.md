# References

External sources behind this project: Cloudflare's documentation, independent write-ups, the upstream game, Tauri, and related work that drives a decision model through a similar API.

## Cloudflare

Checked 2026-10-14. Prices, limits and model versions change; re-check before relying on them.

| Source | Backs |
|---|---|
| [clef-flash model page](https://developers.cloudflare.com/workers-ai/models/clef-flash/) | Request and response schema; limits of 24,576 tokens of context, 64 questions and 4 images; price |
| [clef model page](https://developers.cloudflare.com/workers-ai/models/clef/) | The larger model, for comparison |
| [Changelog: Clef launch (2026-10-01)](https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/) | Models, endpoints, question types, launch latencies |
| [Workers AI changelog](https://developers.cloudflare.com/changelog/product/workers-ai/) | Entry of 2026-10-09: Clef-omni added, Clef-flash price cut, context reduced from 64K to 24K, Clef up to 2x faster |
| [Blog: Introducing Clef](https://blog.cloudflare.com/clef-decision-models) | Use cases, Cloudflare's benchmarks, training method, RL platform |
| [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) | Clef-flash at US$ 0.038 and 3,455 neurons per million tokens; free allocation of 10,000 neurons per day |
| [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/) | Rate limits by category (Clef is not listed) |

## Independent hands-on write-ups

Very small samples; used for observed behavior only.

| Source | Backs |
|---|---|
| [Hands-on with Clef (DEV)](https://dev.to/akari_iku/hands-on-with-cloudflares-decision-model-clef-on-workers-ai-del) | Real response shape, `instructions` being required, sorting of keys and option IDs, limitations |
| [How to use Cloudflare Clef (thejevai.com)](https://thejevai.com/blog/how-to-use-cloudflare-clef) | The `result` envelope on REST, `noul` as an object. It does not describe how to reach Jev |

## Upstream game

| Source | Used for |
|---|---|
| [EvanBacon/Expo-Crossy-Road](https://github.com/EvanBacon/Expo-Crossy-Road) (MIT) | Rules, constants and row generation ported to `packages/core`, read in `src/CrossyGame.ts`, `GameEngine.ts`, `CrossyPlayer.ts`, `Row/Road.ts`, `Row/Water.ts`, `Row/RailRoad.ts` and `package.json`. Models, textures, audio and font come from revision `6f2e84e580c9c8f2b432aa365f706d45d96d8bc9`, downloaded locally and not redistributed. See [NOTICE](../NOTICE) |

## Tauri v2

| Source | Used for |
|---|---|
| [Prerequisites](https://v2.tauri.app/start/prerequisites/) | Rust, MSVC and WebView2 on Windows |
| [HTTP client](https://v2.tauri.app/features/http-client/) | The plugin re-exports `reqwest`, which the Rust side uses to call Workers AI |

## Related work

Other projects drive a decision model through a similar `state` + `choice` API. Most use TypeSafe AI's Jev ("System One"); Clef is a decision model with a similar API (a `state` plus `choice`, `noul` and `score` questions that return probabilities), and this project does not claim it is the same model. These repositories were read for design patterns only: no code from them is used.

| Repository | Game |
|---|---|
| [lukaske/jev-doom-agent](https://github.com/lukaske/jev-doom-agent) | Doom (browser) |
| [olivier-motium/jev-doom](https://github.com/olivier-motium/jev-doom) | Doom (Freedoom) |
| [tirukovelamanoj/jev-plays-doom](https://github.com/tirukovelamanoj/jev-plays-doom) | Doom |
| [fhshaik/typesafe-mario](https://github.com/fhshaik/typesafe-mario) | Super Mario Bros. |
| [pedroarruda07/jev-plays-tetris](https://github.com/pedroarruda07/jev-plays-tetris) | Tetris |
| [phyous/tsai-sc](https://github.com/phyous/tsai-sc) | StarCraft |
| [anxkhn/JevPlaysPokemon](https://github.com/anxkhn/JevPlaysPokemon) | Pokemon FireRed |
| [phyous/tsai-civ2](https://github.com/phyous/tsai-civ2) | Civilization II |
| [Hardel-DW/jev.mods](https://github.com/Hardel-DW/jev.mods) | Minecraft |
| [safzanpirani/pong-jev](https://github.com/safzanpirani/pong-jev) | Pong |
| [tanayvasishtha/Slither-Me-Jev](https://github.com/tanayvasishtha/Slither-Me-Jev) | Snake |
| [skpanigrahy/jev-t-rex-runner](https://github.com/skpanigrahy/jev-t-rex-runner) | Chrome Dino |
| [shantanugoel/jev-games](https://github.com/shantanugoel/jev-games) | Mario, Kung Fu and Doom |

Design patterns that recur across them, and that shaped the gameplay in [ADR-0010](adr/0010-words-rules-maneuver-executor.md) and [ADR-0011](adr/0011-route-controller-three-lookups.md):

1. **Small state, in words or ready-made fields.** The code subtracts, sorts and classifies; the model receives the relation, not arithmetic.
2. **The option text carries the rule.** Options that state their boundary behave differently from options that only state a purpose.
3. **The model picks the maneuver; code executes and times it.** "What to do" is separated from "when and how".
4. **Stale answers are worth little.** Discard or replan on arrival, put the measured delay in the state, or use a forecast instead of the current position.
5. **Several small questions per call are cheap.** They add little latency compared with one large question.
6. **Abstention and honest labels.** Low confidence becomes a visible fallback, and whatever is not the model says so.
7. **Memory in the state**, because every call starts from zero.

Another pattern in these projects, listing only legal moves together with their consequences, is not used here: [ADR-0009](adr/0009-perception-memory-judgement.md) keeps judgement out of the model's input.

## Limits

- How to access Jev (endpoint, key, price) was not found.
- Clef's own rate limit is not documented.
- Clef and Jev are not confirmed to be the same model, so what holds for one may not hold for the other.
- The independent write-ups are small samples.
