# Desktop app

How to run Clef Crossy Road in the browser or as a Tauri v2 window, who can play, what the panel shows, and the launch options.

## Run it

| Mode | Command | Notes |
|---|---|---|
| Browser | `pnpm install`, then `pnpm run dev` | Serves http://localhost:5173 (fixed port, Ctrl+C stops it). The first run downloads Evan Bacon's models, audio and font with `git` (internet required) and reuses them afterwards. Opens on the free **look-ahead** player: no credentials, cache or Rust needed. |
| Desktop (development) | `pnpm run dev:desktop` | Prepares the assets and runs `tauri dev`, which starts its own Vite server and a window with hot reload. Do not run it together with `pnpm run dev`: both use port 5173. |
| Desktop (release) | `pnpm install`, `node scripts/fetch-assets.mjs`, `pnpm --filter @ccr/desktop build`, then `cd apps/desktop && pnpm tauri build --no-bundle` | Produces `apps/desktop/src-tauri/target/release/clef-crossy-road.exe`. |
| Launchers | `play.cmd`, `play-clef.cmd` | Windows `.cmd` files for the release build. `play.cmd` opens the app and prints in its terminal what the model is sent (`CCR_LOG=full` unless already set). `play-clef.cmd` does the same on Clef-flash, seed 6. |

**Platform.** The desktop app needs Node 24+, pnpm 10, Rust, the MSVC C++ build tools and WebView2. It was developed and tested on Windows 11 only, and the launchers are Windows scripts. Browser mode is the portable path.

The window is 1180x800 (minimum 980x660): the Three.js scene on the left and the panel on the right, which is always open.

## Who plays

Pick a player under **Who plays**. The info button next to it shows the player's description, estimated cost and the shortcuts.

| Player | Calls the API | Notes |
|---|---|---|
| **You** | no | Arrow keys or WASD. |
| **Clef-flash** (`clef-flash`) | yes | The code turns the screen into words and asks the model three small questions; a controller does the hopping and the detours, and its steps cost nothing ([ADR-0011](adr/0011-route-controller-three-lookups.md)). About 6 neurons per set of questions. |
| **Clef (27B)** (`clef-27b`) | yes | Same gameplay, about 6.3 times the cost. No map is cached for it. |
| Look-ahead, Always forward, Random | no | References: a 4-hop search over the simulator, the floor, and uniform random. |
| **Custom** | yes, on a cache miss | Appears only when `CCR_PLAYER` names another model combination (see below). Uses the same request cache as other model players. |

The desktop app opens on **Clef-flash** at the first cached map (seed 6). The browser opens on **look-ahead**. The other benchmark conditions are not standing entries; see [benchmark.md](benchmark.md) and [results.md](results.md).

## Replays, cache and cost

`CLEF_CACHED_SEEDS` (seeds 6-8) lists maps whose Clef-flash decisions were recorded by the benchmark, and **New map** walks through them before choosing a random seed. A replay is free **only if the local cache `runs/cache/clef.ndjson` exists**. That file is gitignored, so **a fresh clone has no cache**: the first Clef game on any seed asks the model, spends neurons and needs credentials (**Setup > Cloudflare > Configure**, or `CF_API_TOKEN` and `CF_ACCOUNT_ID` in `.env`). Without them the desktop default stops with an error card. A request of three questions costs about 6 neurons for Clef-flash, and a game made 5 to 67 of them in the measured runs ([results.md](results.md)).

The free path is look-ahead, the other references, or You. A cached replay also only holds while the prompts and the controller are unchanged since the decisions were recorded.

The ceiling is 10,000 neurons per UTC day and is enforced by the Rust process before every call ([SECURITY.md](../SECURITY.md), [ADR-0008](adr/0008-daily-budget-free-tier.md)).

## Keys

Keys are ignored while a field, button, expander or dialog has focus; click the game to give them back. Combinations with Ctrl, Alt or Meta are never game input.

| Key | Action |
|---|---|
| Arrows / WASD | Hop (only when **You** plays). Holding a key or pressing faster than a hop keeps one input queued; it starts after the landing is checked, so hops cannot be chained across water or a road ([game-rules.md](game-rules.md)). |
| Space | Pause / resume |
| N | Run one decision (Step timing, paused, AI player) |
| R | Repeat the same map |
| M | New map |
| I | Open or close the input inspector |
| Esc | Close the inspector, the info popover or the Cloudflare dialog |

## The panel

| Area | What it shows |
|---|---|
| Top | Player selector, **Pause**, **Step**, **Retry**, **New map**. |
| **Setup** (collapsed) | Timing: **Step** (the world waits for the model, as in the benchmark) or **Real-time** (60 Hz; the action lands when the answer arrives). Speed 0.5x-4x. Map seed (unsigned 32-bit integer). **Auto-restart**. **Cloudflare > Configure**: the form takes an account ID and an API token, opens empty, never shows saved values, and saving does not call the API. |
| Last decision | The chosen action, a `cached` or `controller` tag, action probability bars (when available), the last 14 moves, and **Details** (the controller's note, and `confidence`, labelled undocumented by Cloudflare). In the default `route` condition, the bars are derived from the three lookup answers; they are not a direct model vote over moves. Controller-only steps report no probabilities. |
| Counters | Rows, Decisions, Latency, Tokens, Invalid, Cached. |
| Budget | Neurons used today (UTC) against the limit, a meter, the cost of the current game, and a notice once the limit is reached. A cached decision costs 0. |
| Footer | Sound toggle and frames per second. |
| **What it read** (I) | The request exactly as the policy sent it: **State**, **Question**, **Options** and **Answer** (probabilities, tokens, neurons, latency, cache). It goes back 14 decisions and copies the request as JSON. After controller steps it still shows the last model request. |
| End of game | Cause of death, rows crossed, best of the session, **Retry same map** and **New map**. An AI player that goes 40 decisions without a new row is stopped, stops spending, and the card reads `Stuck: no new row in 40 decisions`. |

**Auto-restart** starts a new map 2.2 s after a game ends, but only for free reference players. A player that calls the model never restarts by itself, so a forgotten window cannot use up the day's budget.

## Launch options

| Option | Desktop | Browser dev |
|---|---|---|
| Player | `CCR_PLAYER` | `?player=` |
| Seed | `CCR_SEED` | `&seed=` |
| Terminal log | `CCR_LOG` = `full` (default in `play.cmd`), `brief` (one line per decision) or `off` | `&log=` (printed in the browser console) |

`CCR_PLAYER` accepts `human`, `clef-flash`, `clef-27b`, `lookahead`, `always-forward`, `random` and `clef:<model>:<encoder>:<strategy>[:<manual>]`, which opens a benchmark condition as **Custom** (for example `clef:clef-flash:view-fx:choice:routing`; model, encoder, strategy and manual are the benchmark's ids, and the manual defaults to `full`). `clef` and `clef-words` still mean `clef-flash`. Any other value, including an unknown id, opens look-ahead.

`CCR_LOG` writes the same text to the terminal and to `runs/logs/play.log` (recreated on each launch), in plain ASCII. With no `CCR_LOG` the app prints nothing. `CCR_ROOT` overrides the repository root where the app looks for `.env` and `runs/`; by default it is the nearest ancestor holding `pnpm-workspace.yaml`.

## Self-test

`CCR_SELFTEST=1` makes the desktop app measure FPS, check rendering, the keyboard, the inspector, the budget refusal and a Clef-flash game on a cached seed, write `runs/selftest.json` and exit. It is a scripted check, not for players. Without the local cache that Clef-flash check asks the model for a few decisions and spends neurons if credentials are configured.

## Open questions

1. The NSIS installer and code signing are not built or verified; only `tauri build --no-bundle` is used.
2. A packaged app should keep credentials in the OS keychain instead of `.env` ([SECURITY.md](../SECURITY.md)).
3. The self-test drives the keyboard with synthetic key events; physical keyboard input has not been checked separately.

Implementation notes for contributors live in [../apps/desktop/AGENTS.md](../apps/desktop/AGENTS.md).
