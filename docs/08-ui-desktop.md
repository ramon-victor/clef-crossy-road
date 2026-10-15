# 08 · App desktop (Tauri v2) e painel da IA

> **Status:** implementado e verificado (Fase 3) · **Verificado em:** 2026-10-15 · **ADRs:** [0007](adr/0007-desktop-tauri-token-no-rust.md), [0008](adr/0008-orcamento-diario-no-free-tier.md)

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
| Quem joga | **Dois tamanhos de Clef** com a mesma vista e a mesma pergunta (escolha direta, sem regra nossa por cima, a vista de jogador: a tela inteira, onde as coisas estarão em 0,2 s e as últimas jogadas): **Clef-flash** (`clef-flash`, o padrão dos modelos) e **Clef 27B** (`clef-27b`, cerca de 6× o custo: ~31 neurons por jogada, e só as seeds 1–8 estão no cache). Mais **você** (setas/WASD) e as referências sem API (look-ahead, sempre em frente, aleatório). JSON x grade x imagem e `critic` eram condições do benchmark, não jogadores: ficam em `pnpm bench`, mas qualquer combinação pode ser aberta com `CCR_PLAYER=clef:<modelo>:<vista>:<estratégia>[:<estilo>]` (aparece como "Custom"). O padrão ao abrir é o look-ahead: **abrir o app nunca gasta nada** |
| Tempo | **Step**: o mundo espera o modelo, como no benchmark. **Real-time**: o mundo corre a 60 Hz e a ação vale quando a resposta chega |
| Controles | Pausa (espaço), passo-a-passo (N, só em Step e pausado), retry da mesma seed (R), mapa novo (M), seed editável, velocidade 0,5× a 4× |
| Teclado | Setas ou WASD. Apertar mais rápido que o salto, ou segurar a tecla, deixa a jogada **na fila** (1 vaga, a última vence) e ela começa quando o salto pousa, depois de o pouso ser checado: não dá para atravessar água nem rua encadeando saltos ([04](04-game-core.md), D9) |
| **O que o modelo leu** | Tecla **I** (ou o botão "What it read" no cartão da decisão) abre uma janela sobre o jogo com o pedido da decisão **exatamente como foi enviado**: **State** (o mundo, uma linha por linha), **Question** (as instruções), **Options** (as opções e o texto de cada uma) e **Answer** (probabilidades, tokens, neurons, latência, cache). Mostra a política, o que ela vê e como é perguntada, volta nas últimas 14 decisões e copia o pedido em JSON. Esc fecha |
| Painel | Barras com as `probabilities` **reais** do modelo; `confidence` rotulado como não documentado; histórico das últimas 14 jogadas; tag "cached" |
| Orçamento | Medidor de neurons do dia (UTC), custo estimado por decisão nova, aviso quando o teto é atingido; uma decisão do cache aparece como "cached" e custa 0 |
| Fim de partida | Cartão com a causa da morte, linhas cruzadas e melhor do dia; repetir a mesma seed ou mapa novo. **"Preso"**: um jogador de IA que passa 40 decisões sem uma linha nova (a regra do benchmark) encerra a partida, para de perguntar e de gastar, e o cartão diz "Stuck: no new row in 40 decisions" |
| Som | Sons do original, ligados por padrão após o primeiro gesto do usuário (política dos navegadores) |
| Reinício automático | Para jogadores **gratuitos** (as referências), a janela abre um mapa novo 2,2 s depois de cada fim de partida, para continuar mostrando ação. Jogadores que chamam o modelo **nunca** reiniciam sozinhos: uma janela esquecida aberta não pode gastar o orçamento do dia |
| Replays gratuitos | Cada Clef mostra quais seeds já estão no cache (Flash: 1–100; 27B: 1–8; ambos do benchmark, para a vista `json-fx`). **"Novo mapa" percorre essas seeds em ordem** antes de partir para um mapa aleatório (que gasta neurons) |
| **Logs no terminal** | `.\play.cmd` abre o app **esperando por ele** no mesmo terminal e mostra, a cada decisão, o que foi mandado ao modelo e o que ele respondeu. `CCR_LOG=full` (o padrão do `play.cmd`): no início de cada partida a pergunta e as opções (uma vez, e de novo se mudarem), e por decisão o cabeçalho (`decision N, linha, cached, tokens, neurons, ms`), o **STATE exatamente como enviado** e a resposta com as probabilidades; no fim, a causa da morte, as linhas, as decisões e os neurons da partida. `CCR_LOG=brief`: uma linha por decisão. `CCR_LOG=off` (ou sem a variável, ao abrir o `.exe` direto): nada. As mesmas linhas vão para `runs\logs\play.log` (recriado a cada abertura; bom para colar numa conversa). Só ASCII, para o terminal não quebrar a codificação |
| Atalhos de abertura | `CCR_PLAYER`, `CCR_SEED` e `CCR_LOG` (lidos pelo Rust; no navegador de desenvolvimento, `?player=...&seed=...&log=...`, e o log vai para o `console` do navegador) escolhem o jogador, o mapa e o log iniciais. `CCR_PLAYER` aceita `human`, `clef-flash` (e o antigo `clef`), `clef-27b`, `lookahead`, `always-forward`, `random` ou um id de política do benchmark. `play.cmd` abre o modo normal com o log completo; `play-clef.cmd` abre o Clef-flash na seed 1 (do cache, sem custo). Um id que não existe (por exemplo os antigos `clef-flash-json`) cai no look-ahead gratuito |

## Arquitetura do app

```
apps/desktop/
├─ src/                      # Preact + @ccr/render; Session (lógica sem UI, testada)
│  ├─ session.ts             # humano/IA, step/real-time, pausa, velocidade, cancelamento de respostas em voo; eventos start/decision/end
│  ├─ console-log.ts         # formata os eventos em ASCII (brief/full) e os manda ao terminal (comando `console_log` do Rust)
│  ├─ episode-stats.ts       # latência, tokens, neurons e acertos de cache de uma partida
│  ├─ keymap.ts, seed.ts, launch.ts  # teclas, validação de seeds e opções de abertura: funções puras, testadas
│  ├─ policies.ts            # a lista de jogadores (Clef-flash, Clef 27B, custom) e as seeds que já estão no cache
│  ├─ Panel.tsx, panel/      # o painel: um componente por cartão (jogador, controles, decisão, estatísticas, orçamento)
│  ├─ bridge/                # tauri.ts (IPC), http.ts (só dev no navegador), clef.ts (Transport/Cache/Budget)
│  └─ selftest.ts            # com CCR_SELFTEST=1: mede FPS, confere pixels e a recusa de orçamento, e sai
├─ dev-bridge.ts             # plugin do Vite, só em `vite serve`: mesmos 4 comandos, mesmas regras
└─ src-tauri/src/            # lib.rs (estado e registro), commands.rs (clef_run, cache_*, budget_status),
                             # ledger.rs (orçamento por conta), files.rs, cache.rs, clock.rs, credentials.rs,
                             # error.rs (um só tipo de erro), launch.rs (opções de abertura e autoteste),
                             # logging.rs (CCR_LOG, stdout e runs/logs/play.log; erros de escrita ignorados)
```

O webview **nunca** tem o token: ele chama `clef_run`, e o Rust injeta as credenciais, aplica o teto do dia (constante) e grava o ledger.
O log do terminal passa pelo comando `console_log`, que só imprime texto (o token não passa por ele) e é limitado em tamanho.
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
| Tecla segurada (autoteste, 2026-10-14, WebView2) | `keydown` de `ArrowUp` com `repeat` a cada 16 ms na janela real, na seed 1: **2 ruas e afogado, igual ao jogo de saltos um a um** (sem a fila de entrada, o teste equivalente da `Session` com o núcleo antigo chegava a 66 ruas na seed 1). Mesma rodada: 180 fps (p5 175), 1.073 cores no quadro, Clef 2 de 2 decisões do cache com 0 neurons, teclas 4 de 4 |
| Modo Clef por atalho | Verificado com uma captura só da janela (`PrintWindow`): Clef-flash JSON, seed 1, etiqueta "cached", probabilidades reais e `confidence` 0,06, e o cartão "Drowned · 2 rows" |
| Cartão "Preso" (2026-10-14, WebView2) | Com o jogador aleatório (gratuito) na seed 5, que não ganha linha nova: após 40 decisões aparece "Stuck: no new row in 40 decisions", com Retry e Novo mapa (captura só da janela) |
| Clef padrão pelo cache (2026-10-14) | Autoteste do `.exe` com `json-fx`: 2 de 2 decisões do cache, 0 neurons, gasto do dia inalterado (a memória que o app monta é a do benchmark: há um teste) |
| Visualizador (2026-10-15, WebView2) | O autoteste abre a janela com a tecla I no `.exe` real: estado com as linhas do mundo (1.450 caracteres), regras na pergunta, as cinco jogadas nas opções, e fecha de novo. Captura só da janela mostrando o JSON de uma decisão do Clef |
| Logs no terminal (2026-10-15, `.exe` de release) | `cmd /c play-clef.cmd` com a saída capturada em arquivo: `==== NEW GAME ====`, a pergunta e as opções uma vez, por decisão o cabeçalho, o STATE como enviado e `ANSWER: hop_forward [forward 56% \| ...]`, e `==== GAME OVER: Drowned \| rows 2 \| decisions 2 \| 0.00 neurons \| seed 1 ====`; stderr vazio, 0 caracteres fora do ASCII; o `cmd` terminou quando o `.exe` foi encerrado (o pipe espera mesmo). `CCR_PLAYER=clef-27b CCR_SEED=1 CCR_LOG=brief`: uma linha por decisão, "cached", 0 neurons. Um id custom (`clef:clef-flash:view-fx:choice:routing`) também. O `.exe` aberto direto, sem `CCR_LOG`: 0 bytes em stdout e stderr. `runs\logs\play.log` tem as mesmas 43 linhas não vazias do terminal |
| Autoteste com o build de logs (2026-10-15) | Clef-flash `json-fx` pelo cache (2 de 2, 0 neurons, gasto inalterado), visualizador abre e fecha (estado 1.450 caracteres), 180 fps, 1.059 cores no quadro, tecla segurada igual ao jogo passo a passo |
| Testes | 79 testes do app (`Session` com eventos, teclas, seeds, estatísticas, políticas com os dois Clef e o custom, memória, estagnação, abertura e `console-log`) e 26 testes Rust (datas UTC, taxas de neurons, ledger por conta, linha parcial, cache, erro, seeds, `CCR_LOG`, limite de tamanho do log, erro de escrita ignorado) |

Não verifiquei: teclas físicas do teclado (só eventos sintéticos no mesmo `keydown`), o instalador (`tauri build` com bundle NSIS) e o app com uma
chamada de rede ao vivo em tempo real (as decisões do Clef na janela vieram do cache; o pipeline de rede é o mesmo do benchmark, já exercitado com a API).

## Pré-requisitos (todos instalados em 2026-10-14)

Node 24, pnpm 10, MSVC (Visual Studio com C++), WebView2 155, Rust 1.99 via `rustup` (instalação em nível de usuário, reversível com `rustup self uninstall`).

## Perguntas abertas

1. Instalador (NSIS) e assinatura de código, se o app for distribuído: fora do escopo por ora.
2. Em build empacotado, as credenciais deveriam migrar do `.env` para o chaveiro do SO (`keyring`).
3. O `dist/` do app embute os assets do Evan: ver a nota de IP em [10](10-seguranca-e-licencas.md) antes de distribuir qualquer binário.
