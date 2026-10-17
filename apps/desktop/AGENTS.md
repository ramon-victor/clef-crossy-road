# AGENTS.md: apps/desktop

Applies to everything under `apps/desktop`. The root `AGENTS.md` still applies. UI spec: `docs/08-ui-desktop.md`.

## What this app is

A Tauri v2 window (WebView2) running a Vite + Preact UI and a Three.js scene (`@ccr/render`). Rust (`src-tauri/src`) holds
the Cloudflare credentials and exposes a handful of commands: `commands.rs` (the API call, the cache, the budget), `ledger.rs`
(what is spent, per account) and `launch.rs` (launch options, self-test). The UI watches Clef (or the free references) play, or
lets a person play.

## Hard rules

- **The backend never returns saved credentials.** The settings form accepts new values once and clears them on save/close;
  never prefill from storage or use localStorage/sessionStorage. All API traffic goes through the Rust command `clef_run` (desktop) or, in browser
  development only, the Vite plugin `dev-bridge.ts`. Never import `@ccr/clef/node` from `src/`, never read `.env` in the UI, and never put
  a credential in `index.html`, `tauri.conf.json` or the bundle. After a production build, grep `dist/` for the token prefix.
- `credential_status` returns only `{ configured }`; `save_credentials` validates and atomically updates the root `.env`.
  Saved settings override startup environment values. A request must retain one coherent account/token pair through ledger recording.
- **The budget ceiling is enforced on the native side**, as a constant (10,000 neurons/UTC day), and Rust also writes the ledger
  `runs/cache/spend.ndjson`. The TypeScript `BridgeBudget` only reads it. Do not move enforcement into the webview.
- `clef_run` accepts only `clef`, `clef-flash` and `clef-omni`; no caller-supplied URLs.
- The dev bridge refuses requests from other origins and exists only for `vite serve` (`apply: "serve"`). Keep it that way.
- Browser development defaults to the free look-ahead reference, independent of the local cache.
  Native defaults to Clef-flash on a cached seed; replay is free only when that cache is present.
- Code uses explicit `.ts`/`.tsx` extensions and only erasable TypeScript syntax (no enums, no constructor parameter properties).
- Third-party assets live in `public/assets/` (gitignored) and come from `node scripts/fetch-assets.mjs`. Do not commit them.

## Commands

- `pnpm run dev` at the repository root prepares assets and serves the browser UI at `http://localhost:5173`.
- `pnpm run dev:desktop` at the root prepares assets and starts Tauri development, including its Vite server.
- `pnpm --filter @ccr/desktop test` (Session, key map, seeds, policies; no DOM and no real timers) and `typecheck`.
- `pnpm --filter @ccr/desktop tauri dev`; add `CCR_SELFTEST=1` for the scripted check that writes `runs/selftest.json`.
- `cargo test --lib` in `src-tauri` (PATH needs `%USERPROFILE%\.cargo\bin`).
- To look at the window without grabbing the whole screen, capture it with `PrintWindow` on the app's window handle (a plain
  screen copy also captures whatever else is on top).

## Gotchas

- `Session` is framework-free on purpose; `App.tsx` only subscribes to it. Real-time and step timing share the same loop.
- In step timing the world waits for the model; in real-time it keeps running at 60 Hz and the action lands whenever the answer arrives.
- The scene follows the hero with upstream's 3% per frame easing, expressed frame-rate independently (`followFactor`).
- There are **two** model players, both with the gameplay of ADR-0011 (`DEFAULT_CLEF`: `scene` view, `route` strategy, `lookup` manual): `CLEF_ID` (`clef-flash`) and `CLEF_27B_ID` (`clef-27b`, ~6.3x the cost, no cached map). `clef` and `clef-words` are aliases of `clef-flash`. The controller's steps are `Decision.source === "executor"`: no API call, no neurons, shown with a `controller` tag and `Decision.note`; the inspector (I) shows the last model request and how many controller steps came after it. Every other condition (including the old `json-fx`) reaches the app only as a `Custom` player from `CCR_PLAYER=clef:<model>:<encoder>:<strategy>[:<manual>]` (`customChoice`), never as a standing entry. An unknown `CCR_PLAYER` falls back to the free look-ahead.
- `CLEF_CACHED_SEEDS` (policies.ts) is the range of maps that replay from the cache for Clef-flash. It is only true if the controller makes the same moves as when the games were cached, so check each seed with `bench run --daily-neurons 0` before changing it. The app opens on Clef-flash at the first seed of that range (`App.tsx`); `CCR_PLAYER` and `CCR_SEED` override it.
- `CCR_LOG` (`off` | `brief` | `full`) is read by Rust (`logging.rs`); the webview formats `Session` events in `console-log.ts` (plain ASCII) and sends the text through the `console_log` command, which prints it and appends it to `runs/logs/play.log`. Nothing is printed when it is off. `play.cmd` must stay CRLF and runs the exe through PowerShell (`| Out-Host`) so the terminal waits and shows the output.
- Human key presses go straight to `Game.act`; holding a key or pressing faster than a hop just keeps one input queued in the core.
- The **I** key (or "What it read" on the decision card) opens `InputInspector` with `Decision.sent`, the request exactly as the policy sent it. `ClefPolicy` builds it in one place (`requestFor`), so what is shown is what was sent; the episode records do not keep it.
- **Watching the model decide** has two views of the same decision (`theater/`). The **compass** (**C**) is drawn around the chicken, inside `GameCanvas`: the five moves, each as big as the model wants it **within the fork the routing took** (`barsOf`: a closed way shows the ways round and a block where "go straight" would be, so the lit move is always the biggest; `Decision.probabilities` stays the joint the benchmark records, and 22% of the recorded answers had a biggest joint bar that was not the move made), the chosen **manoeuvre** lit (`winnerOf`, not the controller's first hop; for `leave_platform` it is the decision's own action). What happens to it is read from `Decision.extra.controller` (`RouteStep`, reported by the route controller with every decision, so never from the note's sentence): `hop` -> the choice leaves; `wait` -> it stays and pulses with a pause (the wait is part of "go straight", and the label becomes "when clear", **only if the controller really waited**); `walk`/`leave` -> the hop of the detour or of the way off a platform being made is ringed; `hold` -> the move the refusal makes is ringed and the caption says why (`theater/controller.ts`, `CompassView.waiting`/`actual`/`doing`). The first step is known the moment the model answers, so it is shown while the move is still held for reading, as "next: …"; every step carries its reason (`why`), and the conversation says what the controller did with the answer (`TurnView.said`). A countdown (`EdgeClock`, read from the live game with `platformClock`) sits on the chicken while its platform carries it to the edge of the world. After "Go straight" the controller waits for a gap about 40% of the time and refuses and steps aside a few percent, so never draw the model's choice as if it were the move made; the buttons are a plain cross (↑ ↓ ← → and the pause in a corner) and the arrows are straight: the camera is turned, so a hop forward really climbs the screen about 27 degrees to the right, and that was weighed and left alone; icons are hand-drawn pixel art (`theater/pixel.ts`, `Glyph.tsx`: one arrow turned in quarter turns, plus a few signs); the game's frame loop moves its anchor with `heroScreenPosition(lift)`, the same way as the thought bubble, which it replaces while it is on. The **conversation** (**T**) is the column between the game and the panel: one round per question, from `SessionState.turns` plus the live question (`asking`, set from `DecideHooks.onAsk`, which fires just before the request and never for a controller step): what the game told the model (`sceneOf`, with the platform line when the chicken stood on one), each question with all its options (a fourth, `ride`, only on a platform) and the model's pick (`Decision.answers`, not kept in the episode records, like `sent`), and the controller's steps. Both open by themselves for a model player (`PolicyChoice.kind === "model"`) unless the person chose otherwise (`theater/preference.ts`, `localStorage` behind try/catch). Everything they draw comes from the pure `buildCompass` and `buildFeed`: put new logic there and test it, not in `Compass.tsx`/`Theater.tsx`. Words for the `route` lookups live in `theater/labels.ts`, and a test fails if the strategy gains a question or option without one. The numbers shown (latency, tokens, neurons) are the real ones; never invent them for the screen.
- The **pace** (Setup → Pace: Live, Relaxed, Slow; `Session.setLinger`) holds a model's move for a moment after it answers, so a person can read it. It only applies in step timing, where the world already waits for the model, so the game plays out the same and only takes longer; the answer is on record at once and the controller's own steps are never held. The self-test sets the pace to Live, or its decision counts would wait on a reader.
- `Session` keeps the same `Memory` the benchmark runner builds and hands it to the policy (a test pins this: it is what makes the benchmark's cached answers valid in the app). An AI that goes `DEFAULT_STALL_LIMIT` decisions without a new row is stopped (`stalled`) and stops spending.
