# Internationalization

How the seven UI languages are selected, how translation stays separate from model input, and how to maintain the catalogs.

## Language selection

The UI has local catalogs for English (`en`), Brazilian Portuguese (`pt-BR`), Spanish (`es`), French (`fr`), German (`de`), Japanese (`ja`) and Simplified Chinese (`zh-Hans`). No translation service or runtime download is involved.

**Controls → Preferences → Language** changes presentation immediately without rebuilding the session, policies or canvas. The preference is saved under `ccr.locale`; blocked storage leaves it active only until reload. **Automatic (system)** restores detection, whose result is also displayed. Languages use their own names, without flags.

Tauri obtains the system BCP 47 locale through the OS plugin with only `os:allow-locale`. Browser development uses the first `navigator.languages` entry, falling back to `navigator.language`. Initial detection resolves before the UI mounts.

| Detected language | Catalog |
|---|---|
| English, Spanish, French, German or Japanese variants | Matching language |
| Portuguese variants, including `pt-PT` | Available Brazilian Portuguese catalog |
| `zh`, `zh-CN`, `zh-SG`, `zh-Hans-*` | Simplified Chinese |
| `zh-TW`, `zh-HK`, `zh-Hant-*` | English; traditional writing is not silently replaced with simplified |
| Unsupported, invalid, unavailable or failed detection | English |

Automatic mode detects again on focus and `languagechange`. A late response cannot override a manual selection made while it was pending. The document's `lang` follows the selection; all current catalogs use left-to-right direction.

The game, controls and decisions windows have separate providers. Native `language:changed` events synchronize their preference; browser tabs use `storage`. Receiving a preference neither writes it again nor broadcasts it back. Reopening either auxiliary window restores the preference without creating another session.

## Presentation boundary

`apps/desktop/src/i18n/` contains locale resolution, bootstrap, Preact context, i18next integration, catalogs and presentation helpers. The English catalog defines typed semantic keys. Other catalogs must provide matching keys, interpolation variables and plural forms. Messages are complete sentences; Preact escapes interpolated values, and catalogs contain no translated HTML.

Each language has a fixed translator rather than mutating a global language singleton. `Intl` formats numbers, percentages, speeds, latency and usage. Seeds and technical IDs remain ungrouped so they can be copied and reproduced. `storage.ts` centralizes failure-tolerant preference access.

| Area | Translated | Preserved |
|---|---|---|
| Players | Names, descriptions, help | Policy factories, IDs, cost estimates, cached seeds |
| Controller | Typed `Decision.notice` events rendered on demand | English `note`, `lastResult`, prompts, observations, memory, cache keys, NDJSON |
| Errors | Stable `{ code, message, params? }` codes mapped to explanations | Original details for diagnostics; auth and quota classification |
| Inspector | Labels, explanations, result presentation | Original JSON, question instructions, options and copied request, explicitly identified as English |
| Conversation and compass | Views built with the selected translator | Request bodies, answers and controller execution data |

`SessionState.errorInfo` allows an already displayed error to be translated again; `BridgeError` preserves classification across Rust/Vite, client and session. Inspector tabs use stable `data-tab` attributes so self-tests do not depend on English labels. CLI, reports and terminal logs remain English/ASCII. No dependencies or behavior were added to the deterministic core for localization.

Only non-sensitive preferences use browser storage: `ccr.locale`, `ccr.theater`, `ccr.compass` and `ccr.theater.pace`. Native auxiliary-window visibility is per run; `ccr.theater` controls the browser column only. Pinned decisions are retranslated from original records. Credentials remain in the backend ([SECURITY.md](../SECURITY.md)).

## Editing catalogs

- Update all seven catalogs; preserve interpolation names, full sentences and locale-specific CLDR plurals. Do not build plurals by appending suffixes.
- A row is a horizontal strip of grass, road, river or rail, not specifically a street. A cell is a landing position; a controller is software, not a gamepad.
- Keep Cloudflare, Workers AI, Clef-flash, Tauri, commands, IDs and the usage unit `Neurons` recognizable. Do not invent results, costs or latency in translated messages. The `confidence` field remains explicitly undocumented.
- Use locale-appropriate grammar and forms of address: neutral Spanish, polite French/German, polite Japanese without unnecessary pronouns, Simplified Chinese. Translate direction phrases according to their context rather than substituting an action label everywhere.
- For a new language, add its catalog, own-language name and resolution rules, then check writing direction, plurals and fonts. System fonts cover Japanese and Chinese; the retro font is reserved for game elements and numbers.
- Let long labels wrap and the controls body scroll. A language switch must retain focus, form input, open sections and the active game.

## Validation

Run `pnpm check` and the production web build. Catalog tests check keys, variables, empty strings, plural categories, formatting, regional variants and Chinese writing systems. jsdom integration tests cover focus and input retention, independent providers, cross-window propagation, failed detection/storage, pending detection races, localized errors and copying the original inspector request. Transports and credential persistence are mocked; tests make no model calls.

Earlier compatibility checks compared simulated `route` and `maneuver` games and found identical actions, records, English notes and request bodies. These checks establish presentation isolation, not model performance. Native locale and translated UI behavior still need independent checks on each platform; editorial review by native speakers remains open.

Sources: [i18next TypeScript](https://www.i18next.com/overview/typescript), [i18next plurals](https://www.i18next.com/translation-function/plurals), [Tauri OS information](https://v2.tauri.app/plugin/os-info/), [W3C language tags](https://www.w3.org/International/questions/qa-choosing-language-tags), [Unicode CLDR plurals](https://cldr.unicode.org/index/cldr-spec/plural-rules).
