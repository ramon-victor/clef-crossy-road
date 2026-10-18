# Contributing

Thanks for looking. This is a research project, so the most useful contributions are the ones that keep the results honest:
a bug in the simulation, a mis-ported rule, a flaw in the benchmark statistics, a clearer explanation.

## Setup

```bash
pnpm install --frozen-lockfile
pnpm run dev                    # browser app at http://localhost:5173, free look-ahead player
pnpm check
cd apps/desktop/src-tauri && cargo test --lib     # only if you touch the Rust side
```

Requirements and the desktop build are in the [README](README.md#quick-start). The tests need no network and no credentials.

## Ground rules

- **Never spend more than the free tier.** Every Workers AI call goes through `ClefClient` with a `SpendBudget`. Run
  `pnpm bench plan` before any benchmark that calls a model, and do not add scripts that call the API directly: they bypass the
  ledger ([ADR-0008](docs/adr/0008-daily-budget-free-tier.md)). You do not need a Cloudflare account to work on most of the code.
- **Keep the core deterministic.** `packages/core` must not use `Math.random`, `Date.now`, DOM, Three.js or I/O. Same seed and
  same actions must give an identical snapshot hash.
- **Respect the fairness rule.** An observation holds measured physical facts only: no "safe" labels, no list of valid moves,
  no time-to-collision. Do not change the observation schema without updating
  [ADR-0005](docs/adr/0005-observation-fairness-rule.md) and its schema test.
- **Port rules, not code.** Every ported rule gets a test that cites the file in Expo-Crossy-Road it comes from.
- **Report only real runs.** Numbers in the docs come from an actual benchmark run, with its seeds and confidence interval.
- **Secrets stay in `.env`** (gitignored). Never commit it, and never paste a token into an issue or pull request.

## Pull requests

- Typecheck, lint and tests pass. Add or update a test with the change.
- Update the page in `docs/` that describes the thing you changed, and add or amend an ADR when a decision changes.
- [Conventional Commits](https://www.conventionalcommits.org/), one logical change per commit (`feat(core): …`, `fix(clef): …`,
  `docs: …`).
- Code, identifiers, commits and docs are in English.
- Open an issue first for anything that changes a ported rule, the observation schema or the benchmark protocol.

[AGENTS.md](AGENTS.md) has the same rules in the form AI coding agents read, plus the package map and commands. Security issues:
see [SECURITY.md](SECURITY.md).
