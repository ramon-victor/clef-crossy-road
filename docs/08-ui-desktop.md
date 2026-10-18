# 08 · App desktop (Tauri v2) e painel da IA

> **Status:** implementado e verificado (Fase 3) · **Verificado em:** 2026-10-18 · **ADRs:** [0007](adr/0007-desktop-tauri-token-no-rust.md), [0008](adr/0008-orcamento-diario-no-free-tier.md)

## O que existe

Duas janelas Tauri v2 independentes e redimensionáveis: **Clef Crossy Road** contém o jogo e
**Clef Crossy Road · Controls** contém menus, configurações e decisões da IA. O tamanho inicial desejado
é 900×800 para o jogo (mínimo 640×480) e 360×800 para o painel (mínimo 320×480). A abertura considera
a área útil do monitor e a escala: reduz os tamanhos para caber, posiciona lado a lado quando possível
e permite sobreposição em telas estreitas. O jogo recebe o foco inicial.

No navegador de desenvolvimento, o layout continua integrado: cena à esquerda e painel à direita,
com `clamp(264px, 24vw, 280px)`. Os modelos, texturas, fonte e sons são os do Expo-Crossy-Road,
baixados localmente por `node scripts/fetch-assets.mjs` (ficam fora do git).

Para desenvolver no navegador: `pnpm install` e `pnpm run dev` na raiz, depois abrir
**http://localhost:5173**. O comando prepara os assets e sobe o Vite na porta fixa 5173; Ctrl+C encerra.
O navegador abre no **look-ahead gratuito**, sem depender de credenciais nem de cache. `?player=human`
ou `?player=clef-flash&seed=6` sobrescreve essa escolha; um jogador desconhecido cai no look-ahead.
O desktop mantém o Clef-flash na primeira seed conhecida; a gratuidade desse replay depende do cache
local completo, que fica fora do git. Selecionar um modelo pode fazer chamadas pagas em neurons.

Para desenvolver na janela desktop: `pnpm run dev:desktop` na raiz. O comando prepara os assets
e executa `tauri dev`, que inicia seu próprio Vite e compila/abre a janela com recarga automática.
Requer Rust, ferramentas de compilação C++ do Windows e WebView2. Não executar junto com `pnpm run dev`:
os dois usam a porta 5173. Ctrl+C encerra o processo.

```text
┌─ Clef Crossy Road ───────────────┐   ┌─ Controls ─────────────────┐
│ 86                         [☷]  │   │ QUEM JOGA [select] ⓘ       │
│ rows · best 86 · seed 824413    │   │ [Pausa] [Passo]            │
│                                │   │ [Retry] [Novo mapa]        │
│           [ → 88% ]            │   │ › Setup                   │
│               🐔               │   │ ÚLTIMA DECISÃO            │
│   rio, toras, trilho, carros    │   │ probabilidades · métricas │
│                                │   │ neurons · som · FPS       │
└────────────────────────────────┘   └───────────────────────────┘
```

| Recurso | Como funciona |
|---|---|
| Quem joga | **Dois modelos**, os dois com a mesma jogabilidade ([ADR-0011](adr/0011-controlador-com-rota-e-tres-consultas.md)): o código transforma a tela em palavras, **três perguntas pequenas** vão ao modelo (dá para pisar na casa da frente? as coisas dessa linha se movem? de que lado contornar?) e um **controlador** dá os saltos e caminha os desvios, com passos que não gastam neurons. **Clef-flash** (`clef-flash`, ~6 neurons por conjunto de perguntas; seeds **6–8** verificadas no cache de desenvolvimento) e **Clef (27B)** (`clef-27b`, cerca de 6,3× o custo, ~39 neurons por conjunto, sem mapa em cache). O desktop **abre no Clef-flash na primeira seed conhecida**; o replay só é gratuito se o cache local estiver completo. O navegador abre no look-ahead gratuito. Mais **você** (setas/WASD) e as referências sem API (look-ahead, sempre em frente, aleatório). O `json-fx` antigo (que joga como "sempre em frente"), JSON x grade x imagem e `critic` eram condições do benchmark, não jogadores: ficam em `pnpm bench`, mas qualquer combinação pode ser aberta com `CCR_PLAYER=clef:<modelo>:<vista>:<estratégia>[:<estilo>]` (aparece como "Custom") |
| Tempo | Em **Setup**: **Step**, em que o mundo espera o modelo, como no benchmark; **Real-time**, em que o mundo corre a 60 Hz e a ação vale quando a resposta chega. O modo atual aparece no resumo mesmo com Setup fechado |
| Controles | Pausa (espaço), passo-a-passo (N, só em Step e pausado), retry da mesma seed (R) e mapa novo (M) ficam sempre no topo. **Setup**, inicialmente fechado, reúne tempo, velocidade 0,5× a 4×, seed editável e auto-restart; seu resumo mostra modo, velocidade e seed atuais |
| Teclado | Setas ou WASD. Apertar mais rápido que o salto, ou segurar a tecla, deixa a jogada **na fila** (1 vaga, a última vence) e ela começa quando o salto pousa, depois de o pouso ser checado: não dá para atravessar água nem rua encadeando saltos ([04](04-game-core.md), D9) |
| **O que o modelo leu** | Tecla **I** (ou o botão "What it read" no cartão da decisão) abre o inspector na janela do painel (no navegador, sobre o jogo) com o pedido da decisão **exatamente como foi enviado**: **State** (o mundo, uma linha por linha), **Question** (as instruções), **Options** (as opções e o texto de cada uma) e **Answer** (probabilidades, tokens, neurons, latência, cache). Mostra a política, o que ela vê e como é perguntada, volta nas últimas 14 decisões e copia o pedido em JSON. Esc fecha |
| Controlador | Os passos que o código dá dentro de uma manobra aparecem com a etiqueta **controller** e a nota do que ele faz ("cross_ahead: waiting for the cell (water) to clear, 3/15", "detour_right: hop 2, right (2 to go)"); no terminal, `-> wait (controller)  | ...`. O modelo escolhe a manobra; o controlador espera a casa ficar pisável e dá o salto, ou **caminha o desvio** (volta uma linha se precisar, desliza, avança), e devolve a decisão ao modelo se não há rota, se a galinha não pode ficar onde está, se uma tora a leva à borda ou depois de 3 s. A janela **What it read** (tecla I) mostra o último pedido ao modelo e quantos passos do controlador vieram depois |
| Painel | Ação, tags **cached/controller**, barras com as `probabilities` **reais** quando fornecidas, histórico das últimas 14 jogadas em uma faixa e seis métricas em grade 3×2. **Details**, inicialmente fechado, mostra a nota completa e `confidence` rotulado como não documentado. O botão **What it read (I)** continua disponível durante passos do controlador se o histórico contém um pedido ao modelo |
| Informações ⓘ | Botão ao lado do jogador: título completo do jogo, descrição do jogador selecionado, custo estimado, cache, participação do controlador e atalhos. É um popover nativo, aberto por clique, Enter ou Espaço; Esc, clique externo e o botão × fecham. O aviso de gasto continua visível junto ao seletor |
| Cloudflare | Em **Setup → Cloudflare → Configure**, informar Account ID e API token e escolher **Save credentials**. O backend salva no `.env` local; o formulário abre vazio e exibe apenas se há configuração. O jogo pausa ao abrir e continua pausado ao salvar. O orçamento muda para a conta atual; salvar não chama a API. Cancel ou Esc descartam o que foi digitado |
| Orçamento | Fica na base, junto ao som e FPS: medidor de neurons do dia (UTC), gasto/limite e custo da partida, com aviso aberto quando o teto é atingido. O custo estimado por decisão nova fica no ⓘ; uma decisão do cache aparece como "cached" e custa 0 |
| Fim de partida | Cartão com a causa da morte, linhas cruzadas e melhor do dia; repetir a mesma seed ou mapa novo. **"Preso"**: um jogador de IA que passa 40 decisões sem uma linha nova (a regra do benchmark) encerra a partida, para de perguntar e de gastar, e o cartão diz "Stuck: no new row in 40 decisions" |
| Som | Sons do original, ligados por padrão após o primeiro gesto do usuário (política dos navegadores) |
| Reinício automático | Para jogadores **gratuitos** (as referências), a janela abre um mapa novo 2,2 s depois de cada fim de partida, para continuar mostrando ação. Jogadores que chamam o modelo **nunca** reiniciam sozinhos: uma janela esquecida aberta não pode gastar o orçamento do dia |
| Replays gratuitos | Para a jogabilidade atual, Clef-flash tem as seeds **6–8** em cache; Clef 27B não tem mapa em cache. **"Novo mapa" percorre as seeds em cache em ordem** antes de partir para um mapa aleatório (que gasta neurons) |
| **Logs no terminal** | `.\play.cmd` abre o app **esperando por ele** no mesmo terminal e mostra, a cada decisão, o que foi mandado ao modelo e o que ele respondeu. `CCR_LOG=full` (o padrão do `play.cmd`): no início de cada partida a pergunta e as opções (uma vez, e de novo se mudarem), e por decisão o cabeçalho (`decision N, linha, cached, tokens, neurons, ms`), o **STATE exatamente como enviado** e a resposta com as probabilidades; no fim, a causa da morte, as linhas, as decisões e os neurons da partida. `CCR_LOG=brief`: uma linha por decisão. `CCR_LOG=off` (ou sem a variável, ao abrir o `.exe` direto): nada. As mesmas linhas vão para `runs\logs\play.log` (recriado a cada abertura; bom para colar numa conversa). Só ASCII, para o terminal não quebrar a codificação |
| Atalhos de abertura | `CCR_PLAYER`, `CCR_SEED` e `CCR_LOG` (lidos pelo Rust; no navegador de desenvolvimento, `?player=...&seed=...&log=...`, e o log vai para o `console` do navegador) escolhem o jogador, o mapa e o log iniciais. `CCR_PLAYER` aceita `human`, `clef-flash` (e os antigos `clef` e `clef-words`), `clef-27b`, `lookahead`, `always-forward`, `random` ou um id de política do benchmark. `play.cmd` abre o modo normal com o log completo; `play-clef.cmd` abre o Clef-flash na seed 6 (do cache, sem custo). Um id que não existe (por exemplo os antigos `clef-flash-json`) cai no look-ahead gratuito |

## Janelas independentes no desktop

- O botão discreto **Open controls** no canto superior direito do jogo (36×36 px), ou **F2**,
  mostra e foca o painel. **I** mostra o painel com o inspector aberto. O jogo mantém placar,
  balão de ação, resultado e botões Retry/New map. As janelas mantêm bordas nativas e podem
  ser movidas ou redimensionadas separadamente, sem ajuste automático posterior de posição.
- Fechar o jogo encerra o aplicativo inteiro. Fechar o painel apenas o oculta: a sessão continua
  e o mesmo webview é reutilizado ao reabrir. Diálogos são fechados ao ocultar e credenciais
  digitadas são descartadas; valores salvos nunca preenchem o formulário.
- Minimizar o jogo pausa a sessão e cancela passos pendentes. Restaurar não retoma: é preciso
  Espaço ou Resume. O painel desabilita Resume e Step enquanto o jogo está minimizado.
  Trocar o foco para o painel ou ocultá-lo não pausa a partida. Uma resposta em voo pode
  concluir e é contabilizada; a pausa impede o início de outro turno. O auto-restart gratuito
  também espera a retomada.
- Só o webview do jogo cria `Session`, políticas, `ClefClient`, cena, áudio e log. O painel
  recebe dados serializáveis por eventos direcionados do Tauri, a até 10 Hz, e envia comandos
  confirmados pelo jogo. Reabrir ou recarregar o painel pede uma sincronização, sem reiniciar
  a partida nem repetir comandos. As descrições dos jogadores têm disponibilidade explícita,
  sem transportar as funções das políticas. Nenhuma credencial entra nesses eventos.
- Configure só abre depois de o jogo confirmar a pausa. O formulário envia substituições
  diretamente ao Rust; depois o jogo relê status e orçamento e continua pausado. Som é
  produzido apenas pelo jogo, após o primeiro gesto nessa janela.
- Inspector, formulário e popover ficam limitados à janela do painel, com rolagem e foco
  acessível. Setas e atalhos de movimento pertencem à janela do jogo. O autoteste nativo
  consulta o DOM do inspector no painel e recusa chamadas sem cache, mesmo num checkout novo.

## Organização compacta e acessibilidade

O topo mantém jogador e quatro controles; a base mantém orçamento, som e FPS. Só o corpo intermediário
rola quando Setup ou Details estão abertos, há erro ou a altura disponível diminui. No estado inicial,
com as expansões fechadas, decisão, probabilidades, histórico e métricas cabem na janela mínima,
inclusive com o aviso de orçamento esgotado. Nenhuma seção corta texto para forçar esse encaixe.

O título grande e os parágrafos explicativos saíram do fluxo; o título permanece como heading acessível e
no ⓘ. A descrição selecionada e os atalhos podem ser lidos com teclado e toque. Botões principais têm
32 px de altura; ⓘ, expansões e área clicável do som têm pelo menos 28 px. O foco fica visível.
Setas, WASD, Espaço e os outros atalhos do jogo não são tratados enquanto o usuário opera campos,
botões, expansões ou o inspector. Clicar ou focar o canvas devolve o teclado ao jogo. O inspector move
foco para Close ao abrir e o devolve ao elemento de origem ao fechar.

Setup e Details usam expansões nativas e permanecem abertos durante as atualizações da partida.
No navegador, o inspector usa a mesma variável de largura do painel; com viewport equivalente a zoom e menos de
700 px de largura, ocupa a área disponível. O popover também fica limitado à viewport, com rolagem
própria se necessário.

A organização segue [divulgação progressiva (NN/g)](https://www.nngroup.com/articles/progressive-disclosure/),
[ajuda contextual sem ocultar informação necessária (NN/g)](https://www.nngroup.com/articles/tooltip-guidelines/),
[expansões acessíveis (W3C)](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) e
[alvos de interação (WCAG 2.2)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

## Verificação das duas janelas (2026-10-18)

- Typecheck e lint da raiz passaram; **563 testes TypeScript** (105 do app) e **35 testes Rust**
  passaram. A sincronização cobre painel carregado antes/depois do jogo, reconexão, confirmação
  da pausa, comandos sem repetição e remoção de assinaturas. A pausa cobre resposta em voo
  contabilizada e cancelamento de passo pendente.
- Autotestes dos binários nativos de debug e de release no Linux (GTK/WebKitGTK, X11): jogo sem painel, painel
  sem canvas, foco no painel sem pausar, configuração após pausa confirmada, fechar/ocultar e
  reabrir pelo botão sem reiniciar, formulário limpo, pausa na minimização, ticks parados e
  restauração ainda pausada. Inspector aberto por I no painel e fechado; teclas humanas e
  tecla segurada passaram. Orçamento antes/depois: **0 neurons**; raiz temporária isolada,
  sem credenciais nem cache. O conteúdo de uma decisão real no inspector e o replay do Clef
  foram explicitamente pulados por ausência do cache; nenhuma chamada externa foi enviada.
- Fechamento pelo gerenciador de janelas: F2 reabriu o mesmo painel; fechar o jogo encerrou
  ambos os webviews e o processo terminou com código 0. O build de release
  `tauri build --no-bundle` também passou no Linux; o executável de release passou
  no autoteste sem o servidor Vite em execução.
- Chromium: layout integrado e atalhos preservados; painel separado em 360×800, 320×480,
  225×500 (viewport reduzida para simular escala elevada) e 640×800. Inspector com conteúdo
  de fixture declarado como tal, abas operáveis, corpo rolável e ausência de rolagem horizontal
  da página. Formulário limpo ao ocultar/reabrir; falha na confirmação de pausa não abre
  configuração. Nenhum erro JavaScript e nenhuma chamada de modelo.
- O teste de falha na leitura de credenciais também revelou um travamento anterior no Linux
  quando `.env` é um diretório: agora o Rust lê o arquivo uma vez antes de analisar, usando
  o fallback de ambiente se o armazenamento estiver indisponível. O teste existente de falha
  de gravação voltou a terminar e preserva o par anterior.
- Capturas e relatório nativo em `reports/windows/` (gerados, fora do git). Esta rodada não
  revalida o Windows/WebView2; as verificações anteriores nessa plataforma estão abaixo.

## Verificação do painel compacto (2026-10-15, Chromium)

Capturas da mesma UI Preact, com os assets locais e replays de decisões reais já existentes no cache.
As rotas de teste bloquearam chamadas externas: **nenhuma chamada à API, nenhum gasto novo**.
As capturas ficam em `reports/sidebar/` (gerado, fora do git). Esta rodada verifica o frontend no Chromium;
as verificações anteriores no WebView2 estão registradas abaixo.

| Cenário | Resultado |
|---|---|
| 980×660 | Painel de **264 px**; jogo de **716 px**, antes 608 px. Estado inicial completo, sem rolagem horizontal ou vertical do corpo |
| 1180×800 | Painel de **280 px**; jogo de **900 px**, antes 808 px |
| 1440×900 | Painel de **280 px**; jogo de **1160 px** |
| Interação | ⓘ e Setup abrem com Espaço sem pausar; Esc e clique externo fecham o popover; foco retorna à origem. Inspector abre pelo botão e I, fecha com Esc e devolve foco |
| Estados | Humano, referência sem probabilidades, 14 jogadas no histórico, controlador com acesso ao pedido anterior, Details aberto, seed máxima, seed inválida e jogador Custom com nome longo |
| Orçamento | Esgotado e indisponível permanecem explícitos na base |
| Viewports equivalentes a zoom | 125% (784×528) e 150% (653×440), com base visível, ajustes alcançáveis pela rolagem e popover dentro da viewport |

## Verificação da configuração pela UI (2026-10-15)

- Backend Rust: persistência e releitura, prioridade do arquivo, preservação de outros campos e CRLF,
  valores multilinha preservados como blocos, substituição das credenciais na posição original para
  manter a ordem de interpolação, recusa de arquivo com aspas não fechadas sem alterá-lo,
  validação, retorno somente de status e manutenção do par anterior em falhas de escrita.
- Ponte Vite: persistência, bloqueio de outra origem, mensagens sem valores sensíveis, troca de conta
  sem zerar o ledger e resposta em andamento debitada à conta original; transporte simulado, sem API real.
- Interface Chromium em 980×660, 1180×800 e 653×440: formulário password, validação e erro sem eco do
  valor digitado, salvar/reabrir/recarregar sem preencher segredos, limpeza ao fechar, retorno de foco,
  jogo pausado e atualização do orçamento. Credenciais fictícias e `.env` em diretório temporário isolado.
  Capturas em `reports/credentials/` (gerado, fora do git).

## Verificação do localhost (2026-10-15)

- `pnpm run dev` na raiz serviu a UI em `http://localhost:5173`; download inicial dos assets
  verificado em diretório temporário sem arquivos, com reutilização na segunda execução.
- Chromium em 1180×800: entrada sem query abre look-ahead, jogador desconhecido também; `?player=human&seed=6`
  abre You na seed pedida. Canvas renderizado, assets sem erros HTTP, nenhum erro JavaScript e nenhuma chamada à API.
  Captura em `reports/dev/localhost-1180x800.png` (gerado, fora do git).

## Arquitetura do app

```
apps/desktop/
├─ src/                      # Preact + @ccr/render; Session (lógica sem UI, testada)
│  ├─ session.ts             # humano/IA, step/real-time, pausa, velocidade, cancelamento de respostas em voo; eventos start/decision/end
│  ├─ console-log.ts         # formata os eventos em ASCII (brief/full) e os manda ao terminal (comando `console_log` do Rust)
│  ├─ episode-stats.ts       # latência, tokens, neurons e acertos de cache de uma partida
│  ├─ keymap.ts, seed.ts, launch.ts  # teclas, validação de seeds e opções de abertura: funções puras, testadas
│  ├─ policies.ts            # a lista de jogadores (Clef-flash, Clef 27B, custom) e as seeds que já estão no cache
│  ├─ ControlsApp.tsx, ControlSurface.tsx, controls.ts # painel nativo, apresentação compartilhada e comandos tipados
│  ├─ bridge/windows.ts      # comandos confirmados e snapshots entre os dois webviews
│  ├─ Panel.tsx, panel/      # o painel: um componente por cartão (jogador, controles, decisão, estatísticas, orçamento)
│  ├─ bridge/                # tauri.ts (IPC), http.ts (só dev no navegador), clef.ts (Transport/Cache/Budget)
│  └─ selftest.ts            # com CCR_SELFTEST=1: mede FPS, confere pixels e a recusa de orçamento, e sai
├─ dev-bridge.ts             # plugin do Vite, só em `vite serve`: mesmos 4 comandos, mesmas regras
└─ src-tauri/src/            # lib.rs (estado e registro), commands.rs (clef_run, cache_*, budget_status),
                             # ledger.rs (orçamento por conta), files.rs, cache.rs, clock.rs, credentials.rs,
                             # error.rs (um só tipo de erro), launch.rs (opções de abertura e autoteste),
                             # logging.rs (CCR_LOG, stdout e runs/logs/play.log; erros de escrita ignorados)
```

As credenciais **salvas nunca voltam ao webview**: o formulário só envia novos valores para `save_credentials`;
`credential_status` devolve `{ configured }`. Para jogar, a UI chama `clef_run`, e o Rust injeta as credenciais,
aplica o teto do dia (constante) e grava o ledger. A ponte Vite oferece o mesmo fluxo no desenvolvimento.
O log do terminal passa pelo comando `console_log`, que só imprime texto (o token não passa por ele) e é limitado em tamanho.
O `ClefClient` roda somente no webview do jogo com um `Transport` que atravessa a ponte, mais cache e orçamento também atrás de IPC.
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
| Jogador novo no `.exe` (2026-10-15) | `CCR_PLAYER=clef-words CCR_SEED=10 CCR_LOG=full`: pergunta `go` e `side` mostradas uma vez, por decisão do modelo `cached`, 0 neurons, ledger inalterado (5.537 linhas antes e depois), e os passos do controlador em linhas `#N ... (controller)`. Captura só da janela: 21 ruas em 9 s na seed 10, "Clef-flash + words and controller", etiqueta `cached` e a nota "model chose sidestep_left; sidestep_left: the cell is clear, hopping". Autoteste do build novo: 180 fps, Clef-flash `json-fx` pelo cache com 0 neurons, visualizador, tecla segurada |
| Testes | 82 testes do app (`Session` com eventos, teclas, seeds, estatísticas, políticas com os dois Clef e o custom, memória, estagnação, abertura e `console-log`) e 26 testes Rust (datas UTC, taxas de neurons, ledger por conta, linha parcial, cache, erro, seeds, `CCR_LOG`, limite de tamanho do log, erro de escrita ignorado) |

Não verifiquei: teclas físicas do teclado (só eventos sintéticos no mesmo `keydown`), o instalador (`tauri build` com bundle NSIS) e o app com uma
chamada de rede ao vivo em tempo real (as decisões do Clef na janela vieram do cache; o pipeline de rede é o mesmo do benchmark, já exercitado com a API).

## Pré-requisitos (todos instalados em 2026-10-14)

Node 24, pnpm 10, MSVC (Visual Studio com C++), WebView2 155, Rust 1.99 via `rustup` (instalação em nível de usuário, reversível com `rustup self uninstall`).

## Perguntas abertas

1. Instalador (NSIS) e assinatura de código, se o app for distribuído: fora do escopo por ora.
2. Em build empacotado, as credenciais deveriam migrar do `.env` para o chaveiro do SO (`keyring`).
3. O `dist/` do app embute os assets do Evan: ver a nota de IP em [10](10-seguranca-e-licencas.md) antes de distribuir qualquer binário.
