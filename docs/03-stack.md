# 03 · Stack

> **Status:** em uso (Fases 1 a 4) · **Verificado em:** 2026-10-14 · Versões fixadas no `pnpm-lock.yaml` e no `Cargo.lock`.

| Camada | Escolha (versão) | Por quê | Descartado |
|---|---|---|---|
| Linguagem | TypeScript estrito, ESM (7.0.2) | O repo do Evan já é TS; o Node 24 executa os `.ts` direto, sem etapa de build | JS puro |
| Monorepo | pnpm workspaces, layout estrito (10.12) | Poucos pacotes; só dá para importar o que o `package.json` declara | Turborepo/Nx (exagero), bun, TS project references (nada a emitir) |
| Núcleo | `@ccr/core`, zero dependências | Testável, rápido, reaproveitável como ambiente de RL | Reaproveitar a engine do Evan (acoplada ao Three) |
| PRNG | sfc32 escrito à mão, um fluxo por linha | Determinismo independente da ordem de geração | `Math.random`, bibliotecas |
| Tempo | Passo fixo de 60 Hz, em ticks | Reproduz o ritmo original sem depender do monitor | `dt` variável |
| Render | Three.js 0.182.0 puro | Mesma versão do Evan; o código dele é imperativo e porta direto | React Three Fiber |
| Painel | Preact 11 + Vite 8 | Leve; a lógica do jogo fica numa `Session` sem UI | React |
| Desktop | Tauri 2.12 (WebView2) | Janela nativa leve; token isolado no Rust. O Tauri 3 ainda está em alfa | Electron (pesado) |
| Rust | 1.99; `reqwest` 0.12 (TLS nativo), `dotenvy` | Chamada HTTP e orçamento fora do webview. `reqwest` 0.12 evita dependências extras de TLS no Windows | `reqwest` 0.13 (TLS por padrão exige mais ferramentas) |
| Cliente Clef | `fetch` + zod 4, interfaces `Transport`, `DecisionCache`, `SpendBudget` | Mesmo código no Node e na interface | SDK de terceiros |
| Persistência | NDJSON + cache por hash + ledger de neurons | Reprodutível, auditável, sem banco | SQLite, D1 |
| Testes | Vitest 5 (TS) e `cargo test` (Rust) | Rápido; 186 testes TS e 9 Rust | Jest |
| Lint/format | Biome 2.5 (`preset: "recommended"`) | Uma ferramenta. Atenção: o `biome migrate` troca `recommended: true` por `preset: "none"`, o que desliga o lint | ESLint + Prettier |
| Assets | `scripts/fetch-assets.mjs` | Baixa os modelos do Evan numa revisão fixa; não redistribuímos | Commitar os assets |

## Ambiente (verificado na máquina em 2026-10-14)

| Item | Estado |
|---|---|
| Node | 24.14.1 |
| pnpm | 10.12.1 |
| git | 2.56 (`git init` feito; sem commits) |
| MSVC (Visual Studio 2026, ferramentas C++) | Presente |
| WebView2 | 155 |
| Rust (`rustup`, `cargo`) | 1.99.0, instalado em nível de usuário via `winget` em 2026-10-14 (reversível: `rustup self uninstall`) |
| GPU | NVIDIA RTX 3070 (via ANGLE/D3D11 no WebView2) |
