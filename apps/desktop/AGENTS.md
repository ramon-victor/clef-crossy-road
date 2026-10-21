# AGENTS.md: apps/desktop

Applies to everything under `apps/desktop`. The root `AGENTS.md` still applies. User guide: `docs/desktop-app.md`.

## What this app is

Three independent Tauri v2 windows run a Vite + Preact UI. `main` owns the only Session, ClefClient,
Three.js scene (`@ccr/render`), audio and logs; `controls` and `decisions` are presentation only. Rust (`src-tauri/src`) holds
the Cloudflare credentials and exposes a handful of commands: `commands.rs` (the API call, the cache, the budget), `ledger.rs`
(what is spent, per account) and `launch.rs` (launch options, self-test). The UI watches Clef (or the free references) play, or
lets a person play.

## Hard rules

- **The backend never returns saved credentials.** The settings form accepts new values once and clears them on save/close;
  never prefill credentials from storage or store them in localStorage/sessionStorage. Browser storage is reserved for non-sensitive preferences: `ccr.locale`, `ccr.theater`, `ccr.compass` and `ccr.theater.pace`. All API traffic goes through the Rust command `clef_run` (desktop) or, in browser
  development only, the Vite plugin `dev-bridge.ts`. Never import `@ccr/clef/node` from `src/`, never read `.env` in the UI, and never put
  a credential in `index.html`, `tauri.conf.json` or the bundle. After a production build, grep `dist/` for the token prefix.
- `credential_status` returns only `{ configured }`; `save_credentials` validates and atomically updates the root `.env`.
  Saved settings override startup environment values. A request must retain one coherent account/token pair through ledger recording.
- **The budget ceiling is enforced on the native side**, as a constant (10,000 neurons/UTC day), and Rust also writes the ledger
  `runs/cache/spend.ndjson`. The TypeScript `BridgeBudget` only reads it. Do not move enforcement into the webview.
- `clef_run` accepts only `clef`, `clef-flash` and `clef-omni`; no caller-supplied URLs.
- The dev bridge refuses requests from other origins and exists only for `vite serve` (`apply: "serve"`). Keep it that way.
- Browser development defaults to the free look-ahead reference, independent of the local cache.
  Native defaults to Clef-flash at seed 624140, as does the browser's starting map; model replays are free only when cached.
- Code uses explicit `.ts`/`.tsx` extensions and only erasable TypeScript syntax (no enums, no constructor parameter properties).
- Third-party assets live in `public/assets/` (gitignored) and come from `node scripts/fetch-assets.mjs`. Do not commit them.

## Commands

- `pnpm run dev` at the repository root prepares assets and serves the browser UI at `http://localhost:5173`.
- `pnpm run dev:desktop` at the root prepares assets and starts Tauri development, including its Vite server.
- `pnpm --filter @ccr/desktop test` (Session, key map, seeds, policies and i18n; jsdom only for UI integration tests, no API calls) and `typecheck`.
- `pnpm --filter @ccr/desktop tauri dev`; add `CCR_SELFTEST=1` for the scripted check that writes `runs/selftest.json`.
- `cargo test --lib` in `src-tauri` (PATH needs `%USERPROFILE%\.cargo\bin`).
- To look at the window without grabbing the whole screen, capture it with `PrintWindow` on the app's window handle (a plain
  screen copy also captures whatever else is on top).

## Gotchas

- `bridge/windows.ts` sends serializable snapshots and acknowledged commands between the windows; never create a Session or model client in `ControlsApp` or `DecisionsApp`. Native startup shows only the game; settings and decisions start hidden, even with an old visibility preference. Closing controls hides it and clears dialogs; closing decisions hides it; closing main exits the app. The game button/F2 reopens controls; the matching button below it/T toggles decisions, I opens inline technical details there. Minimizing main pauses until explicit resume; losing focus does not. Browser development keeps the integrated layout.
- Native self-tests are cache-only: `clef_run` refuses misses when `CCR_SELFTEST` is set. Inspect auxiliary DOM through `selftest-controls.ts` and `selftest-decisions.ts`, not from the game webview.
- UI text lives in `src/i18n/locales/`; add all seven translations, preserve interpolation variables and plural forms. Language changes must never recreate a policy/session or translate model input, feedback or cache keys. See `docs/internationalization.md`.
- Language preference changes are broadcast to all three native webviews. Display clocks in remote snapshots are converted between `performance.timeOrigin` values; model input is untouched. The desktop conversation has its own `decisions` window; browser development keeps its conversation column.

- `Session` is framework-free on purpose; `App.tsx` only subscribes to it. Real-time and step timing share the same loop.
- In step timing the world waits for the model; in real-time it keeps running at 60 Hz and the action lands whenever the answer arrives.
- The scene follows the hero with upstream's 3% per frame easing, expressed frame-rate independently (`followFactor`).
- There are **two** model players, both with the gameplay of ADR-0011 (`DEFAULT_CLEF`: `scene` view, `route` strategy, `lookup` manual): `CLEF_ID` (`clef-flash`) and `CLEF_27B_ID` (`clef-27b`, ~6.3x the cost, no cached map). `clef` and `clef-words` are aliases of `clef-flash`. The controller's steps are `Decision.source === "executor"`: no API call, no neurons, shown with a `controller` tag and `Decision.note`; the inspector (I) shows the last model request and how many controller steps came after it. Every other condition (including the old `json-fx`) reaches the app only as a `Custom` player from `CCR_PLAYER=clef:<model>:<encoder>:<strategy>[:<manual>]` (`customChoice`), never as a standing entry. An unknown `CCR_PLAYER` falls back to the free look-ahead.
- `CLEF_CACHED_SEEDS` (policies.ts) is the range of maps that replay from the cache for Clef-flash. It is only true if the controller makes the same moves as when the games were cached, so check each seed with `bench run --daily-neurons 0` before changing it. The app opens on Clef-flash at seed 624140 (`App.tsx`), independently of that range; `CCR_PLAYER` and `CCR_SEED` override it.
- `CCR_LOG` (`off` | `brief` | `full`) is read by Rust (`logging.rs`); the webview formats `Session` events in `console-log.ts` (plain ASCII) and sends the text through the `console_log` command, which prints it and appends it to `runs/logs/play.log`. Nothing is printed when it is off. `play.cmd` must stay CRLF and runs the exe through PowerShell (`| Out-Host`) so the terminal waits and shows the output.
- Human key presses go straight to `Game.act`; holding a key or pressing faster than a hop just keeps one input queued in the core.
- The **I** key (or "What it read" under Details) opens inline `InputInspector` in the conversation with `Decision.sent`, the request exactly as the policy sent it. `ClefPolicy` builds it in one place (`requestFor`), so what is shown is what was sent; the episode records do not keep it.
- **Watching the model decide** has two presentations. The game's compass keeps the pixel-art cross and highlights only the executing action: pause while waiting, then the actual hop. `buildCompass` supplies model context; `buildExecution` reads the live `Snapshot`, `SessionState.playback` and `DecisionLog.observed` to distinguish held, queued, blocked and executing actions. `GameCanvas` updates DOM on execution transitions and passes world coordinates to `GameView.setDecisionOverlay`; `render` never imports `agent`. `Decision.preview` exposes the controller's existing route, including platform drift, for presentation only: never model input, memory, cache keys or benchmark records. Gold marks the executing destination, cyan the remaining forecast; conditional crossings are dashed. One-step refusals preview only that step; retained emergency exits preview the complete remaining route. Delayed or mismatched forecasts are hidden. C hides both compass and path; pause and reduced motion stop pulses. Do not change decision timing for visual legibility. The decisions window uses pure `buildDecisionPresentation` over the six retained consultations and live request: Now shows one action and maneuver sketch, History selects a retained consultation, Details holds probabilities, execution records, episode statistics and exact input. Keep its branch-probability semantics. Settings contains no decision telemetry. Display logic belongs in pure projections, never in core or prompts. All numbers must come from real records.
- Reading pace lives in the decisions footer and uses the existing `Session.setLinger` in step timing only. Controller steps are never held for reading. The self-test sets pace to Live without persisting it. The day/account meter belongs only in settings; episode cost belongs only in decisions.
- `Session` keeps the same `Memory` the benchmark runner builds and hands it to the policy (a test pins this: it is what makes the benchmark's cached answers valid in the app). An AI that goes `DEFAULT_STALL_LIMIT` decisions without a new row is stopped (`stalled`) and stops spending.

- Decision history uses the six retained `SessionState.turns` plus `asking`. Explicit Pin, History and Details pin a bounded session snapshot; Back to live releases it. Scrolling never changes reading mode. Native initial widths are 640/320/360 logical pixels, capped to the work area; respect scale and decorations. New games clear the snapshot. Keep exact input and controller steps tied to the selected round; never count later rounds as its steps. Pinned views are retranslated from original records. A held answer (`phase === "reading"`) is next, not yet sent to the game.
