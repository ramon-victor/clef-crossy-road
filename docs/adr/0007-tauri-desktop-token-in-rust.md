# ADR-0007 · Tauri desktop app with the API token held in Rust

- **Status:** accepted · **Date:** 2026-10-14

## Context and problem statement

The project needs a desktop app in which the model visibly plays the game. The Cloudflare API token must never be reachable from browser code, yet the request logic (retry, schema validation, cache, metrics) has to be shared with the Node benchmark CLI instead of being written twice.

## Considered options

- Tauri v2 with WebView2, with the token and the HTTP call in Rust
- Electron: heavy
- A Vite proxy plugin or a local Node server: more moving parts, and it does not feel like an app
- A browser app with the token in the client: unacceptable

## Decision outcome

Chosen option: **Tauri v2 with WebView2**, because it keeps the secret out of the webview with a small footprint.

- The webview runs Vite, Three.js and Preact. A Rust command, `clef_run`, adds the token and performs the POST; the webview never sees either.
- `@ccr/clef` defines a `Transport` interface with two implementations: Node (the benchmark CLI, token from `.env`) and Tauri (`invoke("clef_run")`). Retry, schema, cache and metrics live once, in TypeScript.
- `clef_run` also enforces the daily neuron ceiling (a constant) and writes the spend ledger, so the UI cannot spend past the free tier ([ADR-0008](0008-daily-budget-free-tier.md)).
- For developing the UI in an ordinary browser there is a development-only bridge (`apps/desktop/dev-bridge.ts`, a Vite plugin with `apply: "serve"`). It follows the same contract and the same ceiling, answers only same-origin requests on localhost, and is not part of the production build. A proxy remains rejected as a production solution.
- **Credentials exception.** A user may type `CF_ACCOUNT_ID` and `CF_API_TOKEN` once, in the Cloudflare settings form (Setup, Cloudflare, Configure). The form sends them to the backend and clears itself on save or close; **saved credentials are never returned to the webview**, which only learns `{ configured }`. Rust (`save_credentials`, `credential_status`) and the dev bridge (`/__ccr/credentials`) validate the input and replace the local `.env`, keeping its other settings; the saved file takes precedence over the environment present at startup. Saving never calls Cloudflare, and the form keeps the game paused. Account and token are read together on each call, so changing them updates the budget view without erasing recorded spend, and calls already in flight keep the original pair and its ledger.

### Consequences

- Good, because the secret is isolated in Rust, the app stays light (no Electron), and one client serves both the CLI and the app.
- Good, because Cloudflare's REST API stays reachable only from the backend, under the same daily ceiling.
- Bad, because building the app needs a Rust toolchain.
- Bad, because credentials are stored in a plain-text `.env`, not in the operating system's keychain.
- Bad, because Three.js performance under WebView2 depends on the machine; the [desktop self-test](../desktop-app.md#self-test) records rendering checks and FPS.
