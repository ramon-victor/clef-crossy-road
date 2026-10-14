# 08 · App desktop (Tauri v2) e painel da IA

> **Status:** implementado e verificado (Fase 3) · **Verificado em:** 2026-10-14 · **ADRs:** [0007](adr/0007-desktop-tauri-token-no-rust.md), [0008](adr/0008-orcamento-diario-no-free-tier.md)

## O que existe

Uma janela Tauri v2 (WebView2) de 1180×800, com a cena Three.js à esquerda e o painel da IA à direita. Os modelos, texturas, fonte e sons
são os do Expo-Crossy-Road, baixados localmente por `node scripts/fetch-assets.mjs` (ficam fora do git).

```
┌───────────────────────────────────────┬──────────────────────┐
│ 86                                    │ CLEF CROSSY ROAD     │
│ rows · best 86 · seed 824413          │ QUEM JOGA: [select]  │
│                                       │ [Step | Real-time]   │
│       ┌───┐                           │ [Pausa] [Passo]      │
│       │ → │  balão sobre a galinha    │ [Retry] [Novo mapa]  │
│       └─┬─┘  (ação + probabilidade)   │ 0.5× 1× 2× 4×  seed  │
│         🐔                            │ ÚLTIMA DECISÃO       │
│   (rio, toras, lírios, trilho,        │  ↑ ████████░░ 88%    │
│    semáforo, caminhões)               │  ← ▌            2%   │
│                                       │  ...                 │
│                                       │ Rows · Decisões ·    │
│                                       │ Latência · Tokens    │
│                                       │ Neurons hoje 26k/10k │
└───────────────────────────────────────┴──────────────────────┘
```

| Recurso | Como funciona |
|---|---|
| Quem joga | Modelos (Clef-flash JSON, grade, `critic-go`, Clef 27B), **você** (setas/WASD) e as referências sem API (look-ahead, sempre em frente, aleatório). O padrão ao abrir é o look-ahead: **abrir o app nunca gasta nada** |
| Tempo | **Step**: o mundo espera o modelo, como no benchmark. **Real-time**: o mundo corre a 60 Hz e a ação vale quando a resposta chega |
| Controles | Pausa (espaço), passo-a-passo (N, só em Step e pausado), retry da mesma seed (R), mapa novo (M), seed editável, velocidade 0,5× a 4× |
| Painel | Barras com as `probabilities` **reais** do modelo (ou o risco de morrer por jogada, no `critic`); `confidence` rotulado como não documentado; histórico das últimas 14 jogadas; tag "cached" |
| Orçamento | Medidor de neurons do dia (UTC), custo estimado por decisão nova, aviso quando o teto é atingido; uma decisão do cache aparece como "cached" e custa 0 |
| Fim de partida | Cartão com a causa da morte, linhas cruzadas e melhor do dia; repetir a mesma seed ou mapa novo |
| Som | Sons do original, ligados por padrão após o primeiro gesto do usuário (política dos navegadores) |
| Reinício automático | Para jogadores **gratuitos** (as referências), a janela abre um mapa novo 2,2 s depois de cada fim de partida, para continuar mostrando ação. Jogadores que chamam o modelo **nunca** reiniciam sozinhos: uma janela esquecida aberta não pode gastar o orçamento do dia |
| Replays gratuitos | Cada modelo mostra quais seeds já estão no cache (Clef-flash JSON e grade: 1–100; `critic-go`: 1–71; Clef 27B: 1–40). **"Novo mapa" percorre essas seeds em ordem** antes de partir para um mapa aleatório (que gasta neurons) |
| Atalhos de abertura | `CCR_PLAYER` e `CCR_SEED` (lidos pelo Rust; no navegador de desenvolvimento, `?player=...&seed=...`) escolhem o jogador e o mapa iniciais. `play.cmd` abre o modo normal; `play-clef.cmd` abre o Clef-flash JSON na seed 1 (do cache, sem custo) |

## Arquitetura do app

```
apps/desktop/
├─ src/                      # Preact + @ccr/render; Session (lógica sem UI, testada)
│  ├─ session.ts             # humano/IA, step/real-time, pausa, velocidade, cancelamento de respostas em voo
│  ├─ episode-stats.ts       # latência, tokens, neurons e acertos de cache de uma partida
│  ├─ keymap.ts, seed.ts, launch.ts  # teclas, validação de seeds e opções de abertura: funções puras, testadas
│  ├─ policies.ts            # a lista de jogadores e as seeds que já estão no cache
│  ├─ Panel.tsx, panel/      # o painel: um componente por cartão (jogador, controles, decisão, estatísticas, orçamento)
│  ├─ bridge/                # tauri.ts (IPC), http.ts (só dev no navegador), clef.ts (Transport/Cache/Budget)
│  └─ selftest.ts            # com CCR_SELFTEST=1: mede FPS, confere pixels e a recusa de orçamento, e sai
├─ dev-bridge.ts             # plugin do Vite, só em `vite serve`: mesmos 4 comandos, mesmas regras
└─ src-tauri/src/            # lib.rs (estado e registro), commands.rs (clef_run, cache_*, budget_status),
                             # ledger.rs (orçamento por conta), files.rs, cache.rs, clock.rs, credentials.rs,
                             # error.rs (um só tipo de erro), launch.rs (opções de abertura e autoteste)
```

O webview **nunca** tem o token: ele chama `clef_run`, e o Rust injeta as credenciais, aplica o teto do dia (constante) e grava o ledger.
O `ClefClient` roda no webview com um `Transport` que atravessa a ponte, mais cache e orçamento também atrás de IPC.
O Rust só aceita `clef`, `clef-flash` e `clef-omni`, sem URL arbitrária.

## Verificação (2026-10-14, WebView2 real, RTX 3070)

| Verificação | Resultado |
|---|---|
| FPS (5 s jogando o look-ahead, 1010×1000 px a 1,25× de pixel ratio) | **média 180, p5 175** (a meta era 60); 88 draw calls e 4.444 triângulos por quadro |
| Renderização | 1.065 cores distintas no quadro: a cena realmente foi desenhada (e vista numa captura da janela) |
| Recusa de orçamento no Rust | Uma chamada de teste foi recusada: "Local daily budget reached: 26347 of 10000 neurons used today (UTC). Nothing was sent." |
| Pipeline do Clef dentro do app | Seed 1 com Clef-flash JSON: 2 de 2 decisões vieram do cache, 0 neurons, gasto inalterado, probabilidades reais exibidas |
| Token fora do webview | O bundle de produção (`dist/`) foi varrido: sem token, sem ID de conta, sem `CF_API_TOKEN=` |
| Executável de release | `tauri build --no-bundle`: **8,4 MB**, compilado em 2m55s |
| Teclado no executável de release | Autoteste do `.exe` de produção: 4 de 4 teclas tratadas pelo modo humano (eventos sintéticos que chegam ao mesmo `keydown`), a galinha se moveu e o placar subiu; o Clef rodou pelo cache com 0 neurons; 180 fps; 1.056 cores no quadro |
| Modo Clef por atalho | Verificado com uma captura só da janela (`PrintWindow`): Clef-flash JSON, seed 1, etiqueta "cached", probabilidades reais e `confidence` 0,06, e o cartão "Drowned · 2 rows" |
| Testes | 45 testes do app (`Session`, teclas, seeds, estatísticas, políticas) e 20 testes Rust (datas UTC, taxas de neurons, ledger por conta, linha parcial, cache, erro, seeds) |

Não verifiquei: teclas físicas do teclado (só eventos sintéticos no mesmo `keydown`), o instalador (`tauri build` com bundle NSIS) e o app com uma
chamada de rede ao vivo em tempo real (as decisões do Clef na janela vieram do cache; o pipeline de rede é o mesmo do benchmark, já exercitado com a API).

## Pré-requisitos (todos instalados em 2026-10-14)

Node 24, pnpm 10, MSVC (Visual Studio com C++), WebView2 155, Rust 1.99 via `rustup` (instalação em nível de usuário, reversível com `rustup self uninstall`).

## Perguntas abertas

1. Instalador (NSIS) e assinatura de código, se o app for distribuído: fora do escopo por ora.
2. Em build empacotado, as credenciais deveriam migrar do `.env` para o chaveiro do SO (`keyring`).
3. O `dist/` do app embute os assets do Evan: ver a nota de IP em [10](10-seguranca-e-licencas.md) antes de distribuir qualquer binário.
