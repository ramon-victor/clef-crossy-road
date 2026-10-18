# ADR-0003 · TypeScript and a pnpm monorepo

- **Status:** accepted · **Date:** 2026-10-14

## Context and problem statement

The project has a game core, an API client, agents, a renderer and two apps (the benchmark CLI and the desktop app). The upstream reference is TypeScript with Three.js, and the same core must be usable from tests, the CLI and the UI. We need one language, fast iteration and a way to keep the package dependency direction honest (see [architecture](../architecture.md)).

## Considered options

- TypeScript with pnpm workspaces, Vitest and Biome.
- Turborepo or Nx on top of a workspace: more machinery than a handful of packages needs.
- bun (upstream's package manager): pnpm's strict layout is what enforces package boundaries here, and it behaves more predictably on Windows.

## Decision outcome

Chosen option: "TypeScript with pnpm workspaces, Vitest and Biome", because a single language covers core, client, UI and CLI and the package manager itself enforces the boundaries.

- TypeScript in `strict` mode, ESM only.
- Packages are consumed as TypeScript source: `exports` points at `src/index.ts` and there is no build step. Imports use the explicit `.ts` extension (`allowImportingTsExtensions`) and only erasable syntax is allowed (`erasableSyntaxOnly`), so Node can run the files directly.
- The dependency direction between packages is enforced by pnpm's strict `node_modules` layout: a package can import only what its `package.json` declares. Each package has its own `typecheck`.
- The core is stricter still: its `tsconfig` loads no DOM or Node types, and a purity test scans its source ([ADR-0004](0004-deterministic-simulation.md)).
- Tests run on Vitest, lint and format on Biome.

### Consequences

- Good, because one language and no intermediate build cover core, client, UI and CLI.
- Good, because package boundaries are checked by the package manager and core determinism by a test.
- Bad, because importing `.ts` files needs `allowImportingTsExtensions`, and bundlers (Vite) must accept it; they do.
- Bad, because the desktop app adds Rust, which stays confined to `apps/desktop/src-tauri` ([desktop app](../desktop-app.md)).
