# Desktop app

How to run Clef Crossy Road in the browser or its three Tauri windows, who can play, what the panel shows, and the launch options.

## Run it

| Mode | Command | Notes |
|---|---|---|
| Browser | `pnpm install`, then `pnpm run dev` | Serves http://localhost:5173 (fixed port, Ctrl+C stops it). The first run downloads Evan Bacon's models, audio and font with `git` (internet required) and reuses them afterwards. Opens on the free **look-ahead** player: no credentials, cache or Rust needed. |
| Desktop (development) | `pnpm run dev:desktop` | Prepares the assets and runs `tauri dev`, which starts its own Vite server and a window with hot reload. Do not run it together with `pnpm run dev`: both use port 5173. |
| Desktop (release) | `pnpm install`, `node scripts/fetch-assets.mjs`, `pnpm --filter @ccr/desktop build`, then `cd apps/desktop && pnpm tauri build --no-bundle` | Produces `apps/desktop/src-tauri/target/release/clef-crossy-road.exe`. |
| Launchers | `play.cmd`, `play-clef.cmd` | Windows `.cmd` files for the release build. `play.cmd` opens the app and prints in its terminal what the model is sent (`CCR_LOG=full` unless already set). `play-clef.cmd` does the same on Clef-flash, seed 7. |

**Platform.** The desktop app needs Node 24+, pnpm 12.14.0 and Rust with the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for the platform (MSVC C++ build tools and WebView2 on Windows). Desktop launch has been verified on Windows, and backend tests have also run on Linux. CI checks TypeScript and the web build on Windows, Linux and macOS; this does not establish native UI support on every platform. The launchers are Windows scripts.

Desktop starts with only the game visible. Settings and decisions are created hidden; each matching game button toggles its window. **F2** always opens and focuses settings, **T** toggles decisions, and **I** opens the latest exact model request. A minimized settings window is restored by its game button. The settings button follows native visibility, including title-bar closure. An earlier visibility preference never opens an auxiliary window at native startup. Browser development keeps an integrated layout: settings and decisions are side columns next to the game, and the same two buttons over the game hide or show them (**T** also toggles decisions; **F2** stays with the browser). The choice is kept in `ccr.settings` and `ccr.theater`.

The game opens in a phone-like portrait window, up to 440 × 800 CSS pixels. Settings opens at 320 pixels wide on its left and decisions at 360 pixels wide on its right, with the same height and aligned tops. On shorter displays the game narrows proportionally, down to 360 pixels. Normal resize minimums are game 360 × 640, settings 320 × 640 and decisions 360 × 640; these shrink only when the work area cannot fit them. Placement includes the monitor work area, margins and window decorations. Windows overlap within the work area when necessary.

The main webview reports its device pixel ratio before the first show, and Rust converts the layout to physical pixels. This preserves the intended content sizes under fractional scaling, including XWayland where GTK and WebKit can report different scales. Initialization happens once per app run: hiding, reopening or reloading a webview preserves manual position and size.

Resize minimums are stored in native logical units, accounting for the CSS/native scale ratio, so they follow per-monitor DPI changes rather than retaining the first monitor's physical pixel limits. Initial placement is best effort: a monitor/positioning failure falls back to the system window defaults, and a focus refusal never prevents the interface from opening. The OS/window manager retains control of activation and placement ([Windows foreground rules](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow), [GTK positioning](https://docs.gtk.org/gtk3/method.Window.move.html)). Native title bars, resize/maximize controls and Windows Snap remain available; the app does not use frameless, topmost or modal companion windows.

Closing an auxiliary window hides it. Hiding settings from either its game button or title bar discards dialogs and unsaved credential input. Closing the game exits all windows. Minimizing the game pauses it until explicit resume; changing focus and reading pinned decisions do not pause the game. Model errors remain visible in the game even with both auxiliaries hidden. Only the game owns a session and model client.

### Linux display compatibility

On Fedora 44 KDE/Wayland with WebKitGTK 2.54.1, opening decisions caused the game and native title bars to flicker during movement. Disabling DMA-BUF alone improved the game but left title-bar flicker; using XWayland with DMA-BUF disabled also stabilized the title bars in the visual comparison. This identifies a working compatibility configuration, not when the underlying issue was introduced.

Before GTK or worker threads start, Linux builds detect Wayland through `XDG_SESSION_TYPE=wayland` or a nonempty `WAYLAND_DISPLAY`. When `DISPLAY` is also available and `GDK_BACKEND` is unset, the app defaults to `GDK_BACKEND=x11,wayland` and, if unset, `WEBKIT_DISABLE_DMABUF_RENDERER=1`. GTK tries X11 first and can fall back to Wayland if X11 cannot connect ([GTK backend selection](https://docs.gtk.org/gtk3/running.html)). This applies to development and release builds and keeps WebGL available.

Explicit environment settings take precedence: an existing `GDK_BACKEND` skips the automatic configuration, and an existing DMA-BUF setting is never replaced. To diagnose native Wayland, run `GDK_BACKEND=wayland pnpm dev:desktop`; to reproduce the tested compatibility settings explicitly, run `GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 pnpm dev:desktop`. X11-only sessions, Wayland sessions without `DISPLAY`, browser development, Windows and macOS retain their existing defaults. Check scale and window placement when using multiple monitors.

## pnpm setup

The repository pins `pnpm@12.14.0`. If an older global pnpm cannot load it (`ERR_PNPM_NO_MATCHING_VERSION` for the old `@pnpm/win-x64` package), update with the [official installer](https://pnpm.io/installation):

```powershell
npx --yes get-pnpm@0.0.5 12.14.0
```

Reopen the terminal, confirm `pnpm --version` prints `12.14.0`, then run `pnpm install --frozen-lockfile`. Do not downgrade the project pin to match an old installer. In PowerShell, `Get-Command pnpm` identifies which installation the shell uses.

## App icon and favicon

The app uses **Neural Pilot**: a white voxel chicken with a red comb, orange beak and feet, and a navy
visor with a cyan light. It was selected from three AI-generated concepts based on the in-game chicken.
The [generation prompt](artwork/app-icon-prompt.md) records the reference and design constraints.

The approved master is `apps/desktop/src-tauri/icons/source.png`, a 1024 × 1024 RGBA PNG with a transparent
background and margins around the character. After changing the master, run `pnpm icons` to rebuild the
desktop PNG, Windows ICO, macOS ICNS and Windows Store sizes with the installed Tauri CLI. The same command
exports `apps/desktop/public/favicon-16x16.png`, `favicon-32x32.png` and a compact `favicon.ico` containing
16, 32 and 48 px frames. `index.html` declares these sizes explicitly for the browser and all webviews.
The exporter needs no credentials, network calls or new dependencies, and does not regenerate the art.
It orders ICNS entries consistently so exporting unchanged artwork produces no binary differences.

Check the exported 16 and 32 px images at their actual size on light and dark surfaces before accepting
an artwork change. Rebuild the native app to update the executable's embedded icon.

## Who plays

Pick a player under **Who plays**. The info button next to it shows the player's description, estimated cost and the shortcuts.

| Player | Calls the API | Notes |
|---|---|---|
| **You** | no | Arrow keys or WASD. |
| **Clef-flash** (`clef-flash`) | yes | The code turns the screen into words and asks three scene lookups, plus `ride` while on a platform; a controller executes the hops and detours ([ADR-0011](adr/0011-route-controller-three-lookups.md)). Controller steps make no API call. The historical three-question request cost about 6 neurons; the platform request is larger. |
| **Clef (27B)** (`clef-27b`) | yes | Same gameplay, about 6.3 times the cost. No map is cached for it. |
| Look-ahead, Always forward, Random | no | References: a 4-hop search over the simulator, the floor, and uniform random. |
| **Custom** | yes, on a cache miss | Appears only when `CCR_PLAYER` names another model combination (see below). Uses the same request cache as other model players. |

The desktop app opens on **Clef-flash** at the first cached map (seed 7). The browser opens on **look-ahead**. The other benchmark conditions are not standing entries; see [benchmark.md](benchmark.md) and [results.md](results.md).

## Replays, cache and cost

`CLEF_CACHED_SEEDS` (range `7-7`, only seed 7) lists maps whose complete Clef-flash replay was verified against the current controller, and **New map** walks through them before choosing a random seed. Seeds 6 and 8 need new answers after the platform-exit fix and are no longer listed. A replay is free **only if the local cache `runs/cache/clef.ndjson` exists**. That file is gitignored, so **a fresh clone has no cache**: the first Clef game on any seed asks the model, spends neurons and needs credentials (**Controls > Cloudflare > Configure**, or `CF_API_TOKEN` and `CF_ACCOUNT_ID` in `.env`). Without them the desktop default stops with an error card. Cost depends on request size and game length; the platform lookup adds a fourth question. Current and historical replays are distinguished in [results.md](results.md#current-controller-revision).

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
| T | Show or hide the independent decisions window (conversation column in browser development, also from the button over the game) |
| Esc | Close the inspector, the info popover or the Cloudflare dialog |

## Settings and decisions

Controls groups the player selector, daily account usage and game commands in one visible surface. Pause/resume is the primary action; **One decision**, **Retry** and **New map** sit alongside it. Timing and speed remain visible below. **Map** holds the seed and auto-restart, **Preferences** holds language and sound, and **Cloudflare** holds write-only credential settings. These secondary groups start collapsed. Daily usage is never hidden inside an account expander; episode cost stays in decisions. Opening credential input first requires an acknowledged pause; saving never calls the API.

Decisions has two tabs:

| Tab | What it shows |
|---|---|
| **Now** | Current status/action and explanation first, followed by the model's chosen maneuver, a compact sketch using the game's own chicken model, and the answers used. The sketch represents recorded actions rather than an inferred safe route. |
| **History** | The six retained consultations, newest first. Each row identifies the decision and row, the model's maneuver, recorded controller action count and cache status. Expanding a consultation shows its recorded actions chronologically without leaving the list or resetting scroll. Only one consultation expands at a time. Equivalent consecutive waits are grouped even as their recorded counters advance, while changes of reason or source remain separate. |

**Technical details** expands inside the current explanation or selected history entry. It contains question answers and probabilities, unused-answer reasons, episode statistics and neurons, rendering FPS, compass toggle and exact **State / Question / Options / Answer** with JSON copy. **I** opens the latest answered consultation in History with its exact input focused and scrolled into view. Closing the inspector with its button or Escape restores focus to the inspection button. The input and execution records always belong to that consultation.

**Pin this move** freezes the current explanation. Opening History or Technical details also pins reading. **Back to live**, or selecting **Now**, releases the snapshot. History shows a new-consultations notice; **Refresh history** explicitly replaces the snapshot. A retained selection stays expanded; an expired selection closes with an explanation instead of silently showing another consultation. Scrolling and expanding entries never pause the game or change reading mode. **Pause game** is explicit. A new episode, player or map clears pinned reading. Changing language retranslates original records without rewriting model input. History and snapshots remain bounded.

The compass keeps its pixel-art cross and highlights **only the current action**: pause while waiting, then the actual hop when it starts. Other directions stay subdued; probabilities remain in the decisions window. Held and queued answers are labelled “Next”; blocked moves never look like executed hops. A countdown on the chicken shows how soon a moving platform carries it past the world edge.

The dark footer card summarizes the current action, with the chosen maneuver as secondary context; a queued action takes precedence there. A wait keeps one short explanation, such as “Waiting for a log”, across controller steps and their idle boundaries. This reading continuity never extends the compass's execution highlight or delays gameplay. Movement, a new consultation, a queued answer, a block or pause updates the caption immediately. The history strip shows up to six icons, groups consecutive controller waits, and has no entry animation or repetition counter. Step counters, consultation timing and full execution records remain in decisions. The card has no ticking clock or path legend; Details opens decisions when it is hidden. Pause appears in the card when visible, otherwise in the game's pause notice. Long translations wrap within the card's 420-pixel maximum width.

A subtle **Predicted path** connects the remaining planned destinations on the ground. Gold marks the executing destination; cyan marks the forecast. A crossing's continuation is dashed while waiting for a gap. The controller replans after every step, so the path can change; it is not a guarantee that the whole maneuver will finish. Completed segments disappear, and a one-step refusal shows only its authorized step. Retained emergency exits show their full remaining route. Delayed forecasts that no longer match the current origin are hidden. **C** toggles the arrows and path together. Game pause freezes effects, reduced-motion preferences disable pulses, and visual effects never delay a move.

The main visual distinguishes what the model chose from the action the controller actually sent: choosing forward can mean waiting for a vehicle first. A held answer is shown as ready and omitted from sent actions, while its exact request remains inspectable. Earlier consultations keep their recorded action when the live game pauses, stops or ends. Controller steps make no new model call. Alternative-answer percentages are available under Technical details and are not survival probabilities. Unknown metrics remain unavailable; cached latency is labelled as the original consultation's latency.

Reading pace is in the decisions footer (**Live**, **Relaxed**, **Slow**). It delays applying model answers only in step timing, where the world already waits. Controller steps are never delayed for reading. Pinning affects presentation only. Reference players and humans have distinct states with no manufactured model consultations.

**Auto-restart** starts a new map 2.2 s after a free reference game ends. Model players never restart automatically. The game HUD retains score and end-of-game controls; an AI player that makes 60 decisions without a new row is stopped and stops spending.

The panels share light surfaces, system typography, restrained borders, yellow primary actions and consistent focus states. The game renderer captures four transparent portraits from its existing chicken mesh and texture once, restores its render state and caches the images in memory. Browser presentation uses these images directly; native decisions receives them through `decisions:artwork`, outside recurring state snapshots and again on synchronization. The SVG sketch embeds the matching portrait. Loading/failure captions keep the action readable without artwork. There is no extra WebGL context or animation loop in the decisions window, and no new runtime dependency. Reduced-motion preferences disable decorative transitions.

**Controls → Preferences → Language** selects English, Brazilian Portuguese, Spanish, French, German, Japanese or Simplified Chinese. Automatic selection follows the system/browser, with English fallback. Changes reach all three windows without restarting the session. Prompts, inspector JSON, CLI and logs stay in English. See [internationalization.md](internationalization.md).

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

For a desktop platform review, also check startup and settings/decisions toggles with native title bars, ordinary resize/maximize, taskbar/work-area limits, and moving windows between displays. On Windows, test 100%, 150% and 200% scaling, change scaling while running, and move from a higher-DPI monitor to a lower-DPI monitor and back. Unit tests cover the logical minimum-size conversion; they do not replace a native Windows/WebView2 visual run. The Fedora native self-test exercises the XWayland compatibility path at fractional scaling; native Wayland remains a separate validation target. These checks follow the [Windows layout and DPI guidance](https://learn.microsoft.com/en-us/windows/apps/get-started/best-practices#layout).

## Open questions

1. The NSIS installer and code signing are not built or verified; only `tauri build --no-bundle` is used.
2. A packaged app should keep credentials in the OS keychain instead of `.env` ([SECURITY.md](../SECURITY.md)).
3. The self-test drives the keyboard with synthetic key events; physical keyboard input has not been checked separately.
4. Native Wayland previously failed minimize/pause checks for both the original three-tab UI and the compact refactor. The Fedora XWayland compatibility configuration passes these checks; native Wayland still needs separate platform investigation.

Implementation notes for contributors live in [../apps/desktop/AGENTS.md](../apps/desktop/AGENTS.md).
