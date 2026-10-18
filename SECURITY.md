# Security Policy

How to report a vulnerability in Clef Crossy Road, and how the project protects Cloudflare credentials, API spend and the desktop app.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting when available: open the **Security** tab and choose **Report a vulnerability** (a security advisory). If that option is unavailable, open an issue requesting a private contact channel, without technical details or secrets. Do not disclose the vulnerability in a public issue.

This is a research project without releases or a support SLA, so reports are handled on a best-effort basis against the `main` branch. Never include a real API token in a report. Examples of what is in scope:

- A path that exposes saved credentials to the webview, the logs, the bundle or the repository.
- A way around the daily spend ceiling.
- A way to use `clef_run` or the credentials against anything other than the Workers AI `clef`, `clef-flash` and `clef-omni` models.
- A way for another origin or tab to reach the development bridge.

## Credentials

| Topic | Rule |
|---|---|
| Where they live | `CF_API_TOKEN` and `CF_ACCOUNT_ID` in a local `.env`, which is gitignored (`.env.example` holds only the names). Never commit real values. |
| Who reads them | Only Node (the benchmark CLI and the Vite dev bridge) and the Rust process. The UI receives only `{ configured }`; saved values never reach the webview or the bundle. |
| Entering them | **Setup > Cloudflare > Configure** is write-only: a password field, no browser storage, cleared on save and on close. Input is validated (32 hexadecimal characters for the account ID; the token itself, without `Bearer` or spaces), and errors never echo what was typed. Saving does not call the API. |
| Saving | The file is rewritten through a temporary `.env.ccr-*.tmp` file and a rename (mode 0600 on Unix). Other settings, comments and line endings are preserved. A saved file takes precedence over the startup environment. |
| In memory | The token lives in the Rust process state and in the Node transport's closure. It is not logged, not returned and not placed in error messages: errors carry only the service's message, and the Rust network error strips the URL. A request keeps one coherent account and token pair until its cost is recorded. |
| Token permissions | Create the token with only the **Workers AI** permission and an expiry. Revoke and replace it if you suspect it was exposed. |
| Packaged app | Not done yet: a distributed build should keep credentials in the OS keychain (the `keyring` crate) instead of `.env`. Never ship a `.env`. |

`pnpm bench` loads `.env` through Node's `--env-file-if-exists` option; scripts that call the CLI directly use `node --env-file=.env`.

## Spend as a safety control

The most likely damage from a mistake (a loop, a forgotten background run) is paid usage beyond the free tier of 10,000 neurons per UTC day. The ceiling is therefore enforced **before** each call, in two independent places:

- `ClefClient` in `packages/clef` (benchmark CLI and UI), against a persistent per-account ledger, `runs/cache/spend.ndjson`.
- The Rust process (desktop app), which holds the ceiling as a constant and is the one that writes the ledger. The Vite dev bridge applies the same rule.

Cache hits cost nothing and are always allowed. The CLI can lower the ceiling (`--daily-neurons`), never raise it. The ledger is local and sees only what this project sent, and a call already in flight when the ceiling is crossed is still billed, so the Cloudflare dashboard remains the final source of truth. See [ADR-0008](docs/adr/0008-daily-budget-free-tier.md) and [ADR-0007](docs/adr/0007-tauri-desktop-token-in-rust.md).

Do not write scripts that call the API directly: they bypass the ledger.

## Tauri hardening

- **CSP.** `tauri.conf.json` sets a restrictive policy. In production `connect-src` allows only `'self'`, `ipc:` and `http://ipc.localhost`, so every API call goes through a Rust command. The development policy adds the local Vite server.
- **`clef_run`.** It accepts only the models `clef`, `clef-flash` and `clef-omni` and builds the URL itself; the webview cannot supply one. A compromised webview therefore cannot point the token at other endpoints.
- **Capabilities.** The `main` and `controls` windows have `core:default` and the read-only `os:allow-locale` permission. Native app commands control window lifecycle. Only `main` owns the session and model client; the controls window receives serializable presentation snapshots and sends acknowledged commands.
- **Dev bridge.** `apps/desktop/dev-bridge.ts` exists only under `vite serve` (`apply: "serve"`) and is not part of any build. The server listens on `localhost`; the bridge rejects a `Host` that is not a loopback name, an `Origin` that differs from the host and a cross-site fetch, and the credentials endpoint requires a JSON content type. Requests without an `Origin` header (non-browser local clients) are accepted, so treat it as a local development tool, not a hardened service.
- **Dependencies.** Run `cargo audit` on the Rust dependencies before distributing a build.

## Third-party assets and licensing

| Item | Terms |
|---|---|
| This repository's code and documentation | MIT ([LICENSE](LICENSE)). |
| Expo-Crossy-Road source (Evan Bacon) | MIT. The game rules in `packages/core` are a port of it; the copyright notice is kept in [NOTICE](NOTICE). |
| Models, textures, audio and font | Not in this repository. `scripts/fetch-assets.mjs` downloads them locally from a pinned upstream revision into `apps/desktop/public/assets/` (gitignored). The upstream README describes their use as educational, under a fair-use rationale, and says its author is not associated with Hipster Whale. The MIT license covers the upstream source code, not the original game's branding or art. |
| App icon | Original artwork generated by `scripts/make-icon.mjs`. |

Release binaries and the web bundle (`apps/desktop/dist`) embed the downloaded assets. Do not redistribute them without replacing the assets and the name, and without review by someone qualified. This project is not affiliated with or endorsed by Hipster Whale, Evan Bacon or Cloudflare.
