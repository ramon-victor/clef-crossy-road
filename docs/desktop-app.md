# Desktop app

How to run Clef Crossy Road in the browser or its three Tauri windows, who can play, what the panel shows, and the launch options.

## Run it

| Mode | Command | Notes |
|---|---|---|
| Browser | `pnpm install`, then `pnpm run dev` | Serves http://localhost:5173 (fixed port, Ctrl+C stops it). The first run downloads Evan Bacon's models, audio and font with `git` (internet required) and reuses them afterwards. Opens on the free **look-ahead** player: no credentials, cache or Rust needed. |
| Desktop (development) | `pnpm run dev:desktop` | Prepares the assets and runs `tauri dev`, which starts its own Vite server and a window with hot reload. Do not run it together with `pnpm run dev`: both use port 5173. |
| Desktop (release) | `pnpm install`, `node scripts/fetch-assets.mjs`, `pnpm --filter @ccr/desktop build`, then `cd apps/desktop && pnpm tauri build --no-bundle` | Produces `apps/desktop/src-tauri/target/release/clef-crossy-road.exe`. |
| Launchers | `play.cmd`, `play-clef.cmd` | Windows `.cmd` files for the release build. `play.cmd` opens the app and prints in its terminal what the model is sent (`CCR_LOG=full` unless already set). `play-clef.cmd` does the same on Clef-flash, seed 6. |

**Platform.** The desktop app needs Node 24+, pnpm 12.14.0 and Rust with the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for the platform (MSVC C++ build tools and WebView2 on Windows). Desktop launch has been verified on Windows, and backend tests have also run on Linux. CI checks TypeScript and the web build on Windows, Linux and macOS; this does not establish native UI support on every platform. The launchers are Windows scripts.

Desktop starts with only the game visible. Settings and decisions are created hidden and open from the two matching game buttons: **F2** for settings, **T** for decisions, and **I** for the latest exact model request. An earlier visibility preference never opens an auxiliary window at native startup. Browser development keeps an integrated layout.

Initial client widths are compact: game 640, settings 320, decisions 360 logical pixels. Height is at most 720 logical pixels. Placement uses the monitor work area, scale factor and window decorations; effective minimum sizes shrink if the available work area is smaller. The game is centered, settings sits to its left and decisions to its right when possible. Windows overlap within the work area when necessary. Hiding and reopening preserves manual positioning and resizing within a run.

Closing an auxiliary window hides it. Closing settings also discards dialogs and unsaved credential input. Closing the game exits all windows. Minimizing the game pauses it until explicit resume; changing focus and reading pinned decisions do not pause the game. Model errors remain visible in the game even with both auxiliaries hidden. Only the game owns a session and model client.

## pnpm setup

The repository pins `pnpm@12.14.0`. If an older global pnpm cannot load it (`ERR_PNPM_NO_MATCHING_VERSION` for the old `@pnpm/win-x64` package), update with the [official installer](https://pnpm.io/installation):

```powershell
npx --yes get-pnpm@0.0.5 12.14.0
```

Reopen the terminal, confirm `pnpm --version` prints `12.14.0`, then run `pnpm install --frozen-lockfile`. Do not downgrade the project pin to match an old installer. In PowerShell, `Get-Command pnpm` identifies which installation the shell uses.

## Who plays

Pick a player under **Who plays**. The info button next to it shows the player's description, estimated cost and the shortcuts.

| Player | Calls the API | Notes |
|---|---|---|
| **You** | no | Arrow keys or WASD. |
| **Clef-flash** (`clef-flash`) | yes | The code turns the screen into words and asks three scene lookups, plus `ride` while on a platform; a controller executes the hops and detours ([ADR-0011](adr/0011-route-controller-three-lookups.md)). Controller steps make no API call. The historical three-question request cost about 6 neurons; the platform request is larger. |
| **Clef (27B)** (`clef-27b`) | yes | Same gameplay, about 6.3 times the cost. No map is cached for it. |
| Look-ahead, Always forward, Random | no | References: a 4-hop search over the simulator, the floor, and uniform random. |
| **Custom** | yes, on a cache miss | Appears only when `CCR_PLAYER` names another model combination (see below). Uses the same request cache as other model players. |

The desktop app opens on **Clef-flash** at the first cached map (seed 6). The browser opens on **look-ahead**. The other benchmark conditions are not standing entries; see [benchmark.md](benchmark.md) and [results.md](results.md).

## Replays, cache and cost

`CLEF_CACHED_SEEDS` (seeds 6-8) lists maps whose Clef-flash decisions were recorded by the benchmark, and **New map** walks through them before choosing a random seed. A replay is free **only if the local cache `runs/cache/clef.ndjson` exists**. That file is gitignored, so **a fresh clone has no cache**: the first Clef game on any seed asks the model, spends neurons and needs credentials (**Setup > Cloudflare > Configure**, or `CF_API_TOKEN` and `CF_ACCOUNT_ID` in `.env`). Without them the desktop default stops with an error card. Cost depends on request size and game length; the platform lookup adds a fourth question. Current and historical replays are distinguished in [results.md](results.md#current-controller-revision).

The free path is look-ahead, the other references, or You. A cached replay also only holds while the prompts and the controller are unchanged since the decisions were recorded.

The ceiling is 10,000 neurons per UTC day and is enforced by the Rust process before every call ([SECURITY.md](../SECURITY.md), [ADR-0008](adr/0008-daily-budget-free-tier.md)).

## Keys

Movement and timing keys are ignored while a field, button, expander or dialog has focus; click the game to give them back. Window and inspection shortcuts remain available from focused buttons. Combinations with Ctrl, Alt or Meta are never game input.

| Key | Action |
|---|---|
| Arrows / WASD | Hop (only when **You** plays). Holding a key or pressing faster than a hop keeps one input queued; it starts after the landing is checked, so hops cannot be chained across water or a road ([game-rules.md](game-rules.md)). |
| Space | Pause / resume |
| N | Run one decision (Step timing, paused, AI player) |
| R | Repeat the same map |
| M | New map |
| F2 | Show and focus native controls |
| I | Show the latest answered request in the conversation’s inline technical details |
| C | Toggle the compass around the chicken |
| T | Show or hide the independent decisions window (conversation column in browser development) |
| Esc | Close the inspector, the info popover or the Cloudflare dialog |

## Settings and decisions

Settings contains the player selector and game controls, followed by three groups: **Game** (timing, speed, map seed and auto-restart), **Appearance and sound** (language and audio), and **Cloudflare** (write-only credentials and daily account usage). Decision telemetry and episode cost appear only in decisions. Opening credential input first requires an acknowledged pause; saving never calls the API.

Decisions has three tabs:

| Tab | What it shows |
|---|---|
| **Now** | One current action, a schematic isometric chicken and intended direction, the model's chosen maneuver, a short controller explanation and the answers used for this move. The sketch represents recorded actions rather than an inferred safe route. |
| **History** | The six retained consultations, newest first. Selecting one pins its original records and returns to the visual explanation. |
| **Details** | All question answers and probabilities, unused-answer reasons, controller steps, episode statistics and neurons, rendering FPS, compass toggle, and exact **State / Question / Options / Answer** with JSON copy. Controller steps belong only to the selected consultation. |

**Pin this move** freezes the explanation; **Back to live** follows current records again. Opening History or Details also pins reading. Scrolling does not change reading mode. The game keeps running independently; **Pause game** is explicit. A new episode, player or map clears the pinned state. Changing language retranslates original records without rewriting model input. History and pinned snapshots are bounded.

The main visual distinguishes what the model chose from the action the controller actually sent: choosing forward can mean waiting for a vehicle first. A held answer is shown as ready and omitted from sent actions, while its exact request remains inspectable. Earlier consultations keep their recorded action when the live game pauses, stops or ends. Controller steps make no new model call. Alternative-answer percentages are available under Details and are not survival probabilities. Unknown metrics remain unavailable; cached latency is labelled as the original consultation's latency.

Reading pace is in the decisions footer (**Live**, **Relaxed**, **Slow**). It delays applying model answers only in step timing, where the world already waits. Controller steps are never delayed for reading. Pinning affects presentation only. Reference players and humans have distinct states with no manufactured model consultations.

**Auto-restart** starts a new map 2.2 s after a free reference game ends. Model players never restart automatically. The game HUD retains score and end-of-game controls; an AI player that makes 60 decisions without a new row is stopped and stops spending.

The visual panel uses the game's light palette, pixel glyphs, a local SVG illustration and brief CSS transitions. Reduced-motion preferences disable decorative movement. It has no additional WebGL renderer or runtime dependency.

**Settings → Appearance and sound → Language** selects English, Brazilian Portuguese, Spanish, French, German, Japanese or Simplified Chinese. Automatic selection follows the system/browser, with English fallback. Changes reach all three windows without restarting the session. Prompts, inspector JSON, CLI and logs stay in English. See [internationalization.md](internationalization.md).

## Launch options

| Option | Desktop | Browser dev |
|---|---|---|
| Player | `CCR_PLAYER` | `?player=` |
| Seed | `CCR_SEED` | `&seed=` |
| Terminal log | `CCR_LOG` = `full` (default in `play.cmd`), `brief` (one line per decision) or `off` | `&log=` (printed in the browser console) |

`CCR_PLAYER` accepts `human`, `clef-flash`, `clef-27b`, `lookahead`, `always-forward`, `random` and `clef:<model>:<encoder>:<strategy>[:<manual>]`, which opens a benchmark condition as **Custom** (for example `clef:clef-flash:view-fx:choice:routing`; model, encoder, strategy and manual are the benchmark's ids, and the manual defaults to `full`). `clef` and `clef-words` still mean `clef-flash`. Any other value, including an unknown id, opens look-ahead.

`CCR_LOG` writes the same text to the terminal and to `runs/logs/play.log` (recreated on each launch), in plain ASCII. With no `CCR_LOG` the app prints nothing. `CCR_ROOT` overrides the repository root where the app looks for `.env` and `runs/`; by default it is the nearest ancestor holding `pnpm-workspace.yaml`.

## Self-test

`CCR_SELFTEST=1` makes the desktop app measure FPS and check rendering, keyboard, controls and decisions lifecycle, the inline inspector, budget refusal and the cached Clef pipeline, write `runs/selftest.json` and exit. Native self-tests are cache-only: Rust refuses cache misses without sending a request, even when credentials are configured.

## Open questions

1. The NSIS installer and code signing are not built or verified; only `tauri build --no-bundle` is used.
2. A packaged app should keep credentials in the OS keychain instead of `.env` ([SECURITY.md](../SECURITY.md)).
3. The self-test drives the keyboard with synthetic key events; physical keyboard input has not been checked separately.

Implementation notes for contributors live in [../apps/desktop/AGENTS.md](../apps/desktop/AGENTS.md).
