# 08 · App desktop (Tauri v2) e painel da IA

> **Status:** implementado e verificado (Fase 3) · **Verificado em:** 2026-10-18 · **ADRs:** [0007](adr/0007-desktop-tauri-token-no-rust.md), [0008](adr/0008-orcamento-diario-no-free-tier.md)

## O que existe

Duas janelas Tauri v2 independentes e redimensionáveis: **Clef Crossy Road** contém o jogo e
**Clef Crossy Road · Controls** contém menus, configurações, conversa e decisões da IA. O tamanho inicial desejado
é 900×800 para o jogo (mínimo 640×480) e 360×800 para o painel (mínimo 320×480). A abertura considera
a área útil do monitor e a escala: reduz os tamanhos para caber, posiciona lado a lado quando possível
e permite sobreposição em telas estreitas. O jogo recebe o foco inicial.

No navegador de desenvolvimento, o layout continua integrado: cena à esquerda, conversa quando aberta e painel à direita,
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
| **Modo Teatro** | Duas vistas da mesma decisão, para entender de relance. **A bússola** (tecla **C**), dentro do jogo: cinco botões em cruz em volta da galinha (↑ ↓ ← → e a pausa no canto), com **ícones pixelados** no estilo do jogo (setas **retas**: a câmera é girada, então na tela o salto "para frente" sobe uns 27° para a direita, e a escolha foi manter as setas retas, que se leem melhor). **Lendo:** pulsam enquanto o pedido está no ar. **Respondeu:** cada um cresce e fica mais sólido com a confiança do modelo, com o percentual embaixo, e o escolhido acende em amarelo (é a **manobra** que o modelo escolheu, não o primeiro salto do controlador). **Depois da resposta, a seta escolhida mostra o que acontece** (o controlador informa o tipo de cada passo: `hop`, `wait`, `walk`, `hold`): se a galinha pula, ela **sai andando**; se a travessia **espera um vão** (carro, trem, tora a chegar), ela **fica e pulsa com uma pausa em cima** e a legenda diz "controller · waiting for a vehicle to pass 2/15" e o rótulo vira "Go straight · when clear" (a espera é parte do "seguir reto", não outra jogada); se o controlador **caminha um desvio**, a escolha continua marcada como destino e a seta do passo atual ganha um **anel azul** ("walking the detour: hop 2, 3 to go"); se **recusa** a travessia e fica parado ou se afasta, o movimento real ganha o anel e a legenda diz por quê (e já durante a leitura, antes de a galinha mexer, como "next: …"); se **sai de uma plataforma** que a leva à borda, a manobra é "Get off the platform" e a seta acesa é o salto que a tira de lá. **As barras são as do ramo que o roteamento seguiu** (a jogada acesa é sempre a maior): numa travessia aberta, ↑ com a chance de atravessar; num caminho fechado, ← → e a pausa pelas respostas de `around`, com um **bloco** no lugar do ↑, e a legenda diz o ramo e a certeza dele ("the way ahead is closed 30%"). **Um contador** ("! ← 1.3 s", vermelho a menos de um segundo) fica na galinha enquanto a plataforma a leva à borda, lido do jogo ao vivo. Embaixo do jogo, uma legenda ("✗ No · ↔ Moves · → Right ⇒ GO STRAIGHT", ou "reading what it sees… 0.8 s") e as últimas 12 jogadas (as do modelo em amarelo, as do controlador pequenas; uma fila de esperas vira **um** chip "⏸ ×3"). **A conversa** (tecla **T**), na coluna: o **GAME** conta o que a tela mostra ("Water, standing still · left: 2 away · right: next to it") e o **CLEF** responde, cada pergunta com **todas as alternativas em pílulas** (luz varrendo enquanto lê; depois a escolhida em amarelo com o percentual e as outras apagadas; "not needed" nas que o roteamento ignorou), a latência e os neurons reais ("answered in 952 ms · 5.1 neurons", ou "replayed · 0.0 neurons"), a jogada ("GO STRAIGHT") e os passos do controlador, a linha do **chão** que o modelo recebeu ("On a platform carried left: the edge of the world is coming up"), a 4ª pergunta quando a galinha está numa plataforma e, sob a jogada, **o que o controlador fez com a resposta** quando não foi só atravessar (esperou, recusou e por quê, caminhou um desvio, saiu da plataforma). As rodadas antigas sobem, esmaecem e viram uma linha ("↑ Go straight ✓ · ▪ · ←"); as 5 últimas ficam. Para os outros jogadores (`Custom`) as perguntas e opções aparecem com o id e a regra que a opção carrega; para o look-ahead, o aleatório e você, a coluna explica que ali não há modelo. A bússola e a conversa abrem por padrão para um modelo; a escolha de cada uma fica no `localStorage`. **Ritmo** (**Setup → Pace**: Live / Relaxed / Slow, padrão Relaxed): segura cada resposta do modelo por 0 / 1 / 2,2 s antes de a galinha se mexer, para dar tempo de ler. Só vale no timing **Step**, em que o mundo já espera o modelo: o jogo sai **idêntico** (há um teste), só demora mais; os passos do controlador não esperam |
| Controlador | Os passos que o código dá dentro de uma manobra aparecem com a etiqueta **controller** e a nota do que ele faz ("cross_ahead: waiting for the cell (water) to clear, 3/15", "detour_right: hop 2, right (2 to go)"); no terminal, `-> wait (controller)  | ...`. O modelo escolhe a manobra; o controlador espera a casa ficar pisável e dá o salto, ou **caminha o desvio** (volta uma linha se precisar, desliza, avança), e devolve a decisão ao modelo se não há rota, se a galinha não pode ficar onde está, se uma tora a leva à borda ou depois de 3 s. A janela **What it read** (tecla I) mostra o último pedido ao modelo e quantos passos do controlador vieram depois |
| Painel | Ação, tags **cached/controller**, barras com as `probabilities` **reais** quando fornecidas, histórico das últimas 14 jogadas em uma faixa e seis métricas em grade 3×2. **Details**, inicialmente fechado, mostra a nota completa e `confidence` rotulado como não documentado. O botão **What it read (I)** continua disponível durante passos do controlador se o histórico contém um pedido ao modelo |
| Informações ⓘ | Botão ao lado do jogador: título completo do jogo, descrição do jogador selecionado, custo estimado, cache, participação do controlador e atalhos. É um popover nativo, aberto por clique, Enter ou Espaço; Esc, clique externo e o botão × fecham. O aviso de gasto continua visível junto ao seletor |
| Cloudflare | Em **Setup → Cloudflare → Configure**, informar Account ID e API token e escolher **Save credentials**. O backend salva no `.env` local; o formulário abre vazio e exibe apenas se há configuração. O jogo pausa ao abrir e continua pausado ao salvar. O orçamento muda para a conta atual; salvar não chama a API. Cancel ou Esc descartam o que foi digitado |
| Orçamento | Fica na base, junto ao som e FPS: medidor de neurons do dia (UTC), gasto/limite e custo da partida, com aviso aberto quando o teto é atingido. O custo estimado por decisão nova fica no ⓘ; uma decisão do cache aparece como "cached" e custa 0 |
| Fim de partida | Cartão com a causa da morte, linhas cruzadas e melhor do dia; repetir a mesma seed ou mapa novo. **"Preso"**: um jogador de IA que passa 60 decisões sem uma linha nova (a regra do benchmark; eram 40 até 2026-10-16) encerra a partida, para de perguntar e de gastar, e o cartão diz "Stuck: no new row in 40 decisions" |
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
  recebe dados serializáveis por eventos direcionados do Tauri, periodicamente a 10 Hz e após comandos, e envia comandos
  confirmados pelo jogo. Reabrir ou recarregar o painel pede uma sincronização, sem reiniciar
  a partida nem repetir comandos. As descrições dos jogadores têm disponibilidade explícita,
  sem transportar as funções das políticas. Nenhuma credencial entra nesses eventos.
- A conversa fica no corpo rolável do painel, com altura limitada; a bússola continua no jogo.
  Conversa, bússola e ritmo usam os comandos confirmados da sessão. O relógio de uma pergunta
  em andamento é convertido entre as origens de `performance.now()` dos webviews, inclusive
  após recarregar o painel; o pedido ao modelo permanece idêntico.
- Configure só abre depois de o jogo confirmar a pausa. O formulário envia substituições
  diretamente ao Rust; depois o jogo relê status e orçamento e continua pausado. Som é
  produzido apenas pelo jogo, após o primeiro gesto nessa janela.
- Inspector, formulário e popover ficam limitados à janela do painel, com rolagem e foco
  acessível. Setas e atalhos de movimento pertencem à janela do jogo. O autoteste nativo
  consulta o DOM do inspector no painel e recusa chamadas sem cache, mesmo num checkout novo.

## Idioma da interface

A interface tem inglês, português brasileiro, espanhol, francês, alemão, japonês e chinês simplificado.
**Configurações → Idioma** troca o idioma imediatamente e lembra a preferência; “Automático (sistema)”
retoma a detecção nativa do Tauri ou do navegador de desenvolvimento. Idioma não atendido cai em inglês.
As duas janelas recebem a troca por evento nativo, sem recriar a sessão. Números e plurais seguem a língua selecionada. Prompts e JSON do inspector continuam originais, em
inglês, com identificação explícita. CLI e logs continuam em inglês/ASCII.

Jogadores mantêm suas fábricas independentes dos textos. `Decision.notice` acrescenta eventos de
apresentação sem alterar notas, memória ou pedidos do modelo; `SessionState.errorInfo` preserva os
códigos de falha para tradução na hora da renderização. Rust e Vite devolvem falhas estruturadas
`{ code, message, params? }`; detalhes técnicos continuam disponíveis numa expansão. Só preferências
não sensíveis (idioma, conversa, bússola e ritmo) são salvas no armazenamento do webview, nunca
credenciais. Contratos, glossário e fontes em [12](12-i18n.md).

## Organização compacta e acessibilidade

O topo mantém jogador e quatro controles; a base mantém orçamento, som e FPS. Só o corpo intermediário
rola quando Setup ou Details estão abertos, há erro ou a altura disponível diminui. Os rótulos traduzidos podem quebrar em mais de uma linha; quando necessário, o corpo intermediário
rola e mantém as métricas e configurações alcançáveis, inclusive com orçamento esgotado.
Nenhuma seção corta texto para forçar o encaixe.

O título grande e os parágrafos explicativos saíram do fluxo; o título permanece como heading acessível e
no ⓘ. A descrição selecionada e os atalhos podem ser lidos com teclado e toque. Botões principais têm
32 px de altura; ⓘ, expansões e área clicável do som têm pelo menos 28 px. O foco fica visível.
F2 reabre o painel mesmo com um botão do jogo focado. Setas, WASD, Espaço e os outros atalhos do jogo não são tratados enquanto o usuário opera campos,
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

## Revisão e integração com a main (2026-10-18)

- Preservados os sete idiomas, bússola, conversa e ritmo que chegaram pela `main`.
  A revisão corrigiu F2 com botão do jogo focado, sincronização de idioma entre os webviews,
  conversão do relógio da pergunta após recarregar o painel e botões do inspector que ficavam
  cortados em escala elevada. Uma confirmação tardia da pausa não reabre o formulário ocultado.
- Typecheck e lint da raiz passaram; **801 testes TypeScript** (275 do app) e **35 testes Rust**
  passaram. Testes de integração cobrem os atalhos, a corrida ao ocultar configurações e os
  comandos de conversa/bússola/ritmo; a conversão do relógio preserva o pedido original.
- Autotestes nativos de debug e release no Linux: inspector no painel com estado, pergunta e opções reais
  do cache; bússola com cinco direções e uma escolha; conversa no painel com três respostas.
  Trocar para japonês sincronizou ambos os documentos, preservou a partida e restaurou o idioma
  original. Foco, configuração, ocultar/reabrir, minimização, teclado e renderização passaram.
  No trecho do Clef foram três decisões, duas do modelo em cache e uma do controlador;
  **0 chamadas à API, 0 neurons**, sem credenciais nem ledger na raiz temporária.
  O build `tauri build --no-bundle` passou; o release foi testado sem servidor Vite.
- Chromium: navegador integrado e painel em 360×800, 320×480, 225×500 e 640×800;
  sete idiomas no inspector em 360×800 e 225×500, sem botões cortados nem rolagem horizontal
  da página. Ocultar descarta o formulário; falha de pausa impede abrir configurações.
  Nenhum erro JavaScript e nenhuma chamada de modelo. Capturas e relatórios em
  `reports/review-windows/` (gerados, fora do git). Windows/WebView2 não revalidado nesta rodada.

### Perguntas abertas da validação nativa

- Confirmar os atalhos físicos nesta sessão Linux: a automação X11 não entregou F2 ao DOM,
  então a reabertura por esse método ficou inconclusiva. O handler de F2 com botão focado
  passa no teste de integração; o botão de reabrir passa no autoteste nativo.
- Revalidar as duas janelas no Windows/WebView2.

## Verificação inicial das duas janelas (2026-10-18)

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
│  ├─ session.ts             # humano/IA, step/real-time, pausa, velocidade, cancelamento de respostas em voo; eventos start/decision/end;
│  │                         # `asking` (a pergunta em voo), `lastModel`, `turns` (as últimas 6 perguntas com os passos do controlador de cada uma) e o ritmo (`setLinger`)
│  ├─ console-log.ts         # formata os eventos em ASCII (brief/full) e os manda ao terminal (comando `console_log` do Rust)
│  ├─ episode-stats.ts       # latência, tokens, neurons e acertos de cache de uma partida
│  ├─ theater/               # o Modo Teatro: compass.ts e feed.ts (tudo o que cada vista desenha, funções puras), view.ts (perguntas e
│  │                         # alternativas), labels.ts (as palavras e a cena em uma frase), frame.ts, preference.ts (abrir/fechar e ritmo);
│  │                         # Compass.tsx e Theater.tsx só desenham
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
| Cartão "Preso" (2026-10-14, WebView2) | Com o jogador aleatório (gratuito) na seed 5, que não ganha linha nova: após 40 decisões (o limite de então; hoje 60) aparece "Stuck: no new row in 40 decisions", com Retry e Novo mapa (captura só da janela) |
| Clef padrão pelo cache (2026-10-14) | Autoteste do `.exe` com `json-fx`: 2 de 2 decisões do cache, 0 neurons, gasto do dia inalterado (a memória que o app monta é a do benchmark: há um teste) |
| Visualizador (2026-10-15, WebView2) | O autoteste abre a janela com a tecla I no `.exe` real: estado com as linhas do mundo (1.450 caracteres), regras na pergunta, as cinco jogadas nas opções, e fecha de novo. Captura só da janela mostrando o JSON de uma decisão do Clef |
| Logs no terminal (2026-10-15, `.exe` de release) | `cmd /c play-clef.cmd` com a saída capturada em arquivo: `==== NEW GAME ====`, a pergunta e as opções uma vez, por decisão o cabeçalho, o STATE como enviado e `ANSWER: hop_forward [forward 56% \| ...]`, e `==== GAME OVER: Drowned \| rows 2 \| decisions 2 \| 0.00 neurons \| seed 1 ====`; stderr vazio, 0 caracteres fora do ASCII; o `cmd` terminou quando o `.exe` foi encerrado (o pipe espera mesmo). `CCR_PLAYER=clef-27b CCR_SEED=1 CCR_LOG=brief`: uma linha por decisão, "cached", 0 neurons. Um id custom (`clef:clef-flash:view-fx:choice:routing`) também. O `.exe` aberto direto, sem `CCR_LOG`: 0 bytes em stdout e stderr. `runs\logs\play.log` tem as mesmas 43 linhas não vazias do terminal |
| Autoteste com o build de logs (2026-10-15) | Clef-flash `json-fx` pelo cache (2 de 2, 0 neurons, gasto inalterado), visualizador abre e fecha (estado 1.450 caracteres), 180 fps, 1.059 cores no quadro, tecla segurada igual ao jogo passo a passo |
| Jogador novo no `.exe` (2026-10-15) | `CCR_PLAYER=clef-words CCR_SEED=10 CCR_LOG=full`: pergunta `go` e `side` mostradas uma vez, por decisão do modelo `cached`, 0 neurons, ledger inalterado (5.537 linhas antes e depois), e os passos do controlador em linhas `#N ... (controller)`. Captura só da janela: 21 ruas em 9 s na seed 10, "Clef-flash + words and controller", etiqueta `cached` e a nota "model chose sidestep_left; sidestep_left: the cell is clear, hopping". Autoteste do build novo: 180 fps, Clef-flash `json-fx` pelo cache com 0 neurons, visualizador, tecla segurada |
| Testes | 82 testes do app (`Session` com eventos, teclas, seeds, estatísticas, políticas com os dois Clef e o custom, memória, estagnação, abertura e `console-log`) e 26 testes Rust (datas UTC, taxas de neurons, ledger por conta, linha parcial, cache, erro, seeds, `CCR_LOG`, limite de tamanho do log, erro de escrita ignorado) |

## Verificação do Modo Teatro (2026-10-15)

A primeira versão do Teatro (uma coluna de cards com barras e um veredito) foi trocada depois de ficar **confusa** ("parece um formulário de debug"): hoje são a
bússola no jogo e a conversa na coluna, escolhidas entre três conceitos animados.

| Verificação | Resultado |
|---|---|
| Camada de dados | `DecideHooks.onAsk` é chamado **uma vez, antes** de a requisição sair e nunca num passo do controlador; `Decision.answers` traz `choice` e as probabilidades de cada pergunta e **não** entra nos registros do benchmark |
| `Session` | `asking` vale do envio até a resposta, nos dois timings; `lastModel`, `stepsSinceModel` e `turns` (6 rodadas, 8 passos cada) separam a resposta do modelo dos passos do controlador; o ritmo segura a jogada sem segurar o registro e o jogo termina **idêntico** com e sem ele |
| Vistas puras | Cadeia real (política de rota → `Session` → `buildCompass`/`buildFeed`) com um transporte falso: o vencedor é a manobra e não o primeiro salto (um desvio que começa dando um passo atrás acende a seta certa), a conjunta de probabilidades bate com a gravada, `go` só depois de liberada a jogada, escondida sem probabilidades ou com o jogo encerrado; a conversa agrupa os passos sob a resposta, mostra a rodada ao vivo e encolhe as antigas; a cena em uma frase sai do estado real de 8 mapas. Um teste falha se uma opção do `route` ficar sem rótulo |
| Chromium (Playwright), 1180×800 e 980×660 | O app real com **um modelo de mentira** respondendo a `/__ccr/run` no navegador (nenhuma chamada saiu): bússola lendo, respondendo e saindo, legenda, conversa com pílulas e "not needed", `C` e `T` escondem e trazem de volta, e com `prefers-reduced-motion: reduce` tudo aparece já no estado final. As probabilidades dessas capturas são do modelo de mentira e **não são resultado de nada** |
| Replay real do cache (seed 6, Clef-flash) | No app de verdade, sem mock e sem `.env`: bússola com 5 botões e 1 aceso, legenda "✗ No · ↔ Moves · → Right ⇒ Go straight", 5 rodadas na conversa (4 antigas), "replayed · 0.0 neurons", **0 chamadas ao bridge**, 0 neurons no dia |
| Direção das setas (2026-10-15) | Achado: a câmera (ortográfica, girada ~19° em torno da vertical) leva "frente" a **27° para a direita** da vertical e deixa esquerda/direita a 13° da horizontal (medido no jogo: 16° a 29° à direita num salto para frente, com o seguimento da câmera suavizando). Eu tinha desenhado as setas nesses ângulos (setas diagonais pixeladas) e a escolha final foi **setas retas** em cruz, que se leem melhor; o achado fica registrado aqui |
| O que o controlador faz depois de "Go straight" (replay offline das seeds 6-8) | Em 67 manobras `cross_ahead`: primeiro movimento `hop_forward` em 35, **`stay` em 26** (espera um vão), `hop_right` em 4 e `hop_back` em 2 (recusou e se afastou). Era isso o "a seta disse reto e ele foi pro lado" (e a barra ↑ 100% com o rótulo WAIT no card). Agora o controlador reporta o tipo de cada passo (`RouteStep`, em `Decision.extra.controller`) e a tela o mostra: espera, desvio e recusa têm cada um a sua marca. **Nenhum movimento mudou**: o replay das seeds 6, 7 e 8 dá os mesmos 9/30, 8/72 e 39/171 (placar/decisões) de antes |
| Estados do controlador no replay real | Seeds 6-8 no app de verdade: espera ("Go straight · when clear", pausa na seta, "waiting for a vehicle to pass 1/15" e, depois, "⏸ ×2" na faixa), desvio ("walking the detour: hop 1, 2 to go", anel no passo) e recusa ("refused, no way to an opening on the right within 8 hops; waiting where it is safe", anel na pausa); o card do painel passa a nomear a **escolha do modelo** e a dizer o que o controlador faz |
| Review de código (2026-10-15) | Achou 7 pontos, todos tratados: o falso desvio quando um passo é a própria escolha; o relógio que re-renderizava a bússola e a conversa a cada 50 ms (virou um componente `Clock` a 100 ms); o autoteste apagando as preferências da pessoa (agora lê antes e restaura, e o ritmo dele não é gravado); `compassOpen`/`theaterOpen` duplicadas (`openByDefault`, `readFlag`/`writeFlag`); a posição da galinha projetada duas vezes por quadro; a jogada **contada no log e nas estatísticas antes de a galinha mexer** com o ritmo (agora só ao jogar; um reinício na espera não conta uma jogada que não houve); e um índice repetido possível na conversa. Num segundo review: o teto de 8 passos por rodada (uma espera tem até 15 e um desvio 12, e a conversa contradizia a legenda; agora 24), o contador de segundos dentro de uma região `aria-live` (agora fora do alcance de leitores de tela) e o `extra.controller`, que é só para a tela e **não entra** nos registros do benchmark, como `sent` e `answers` (`recordableExtra`) |
| Lint, tipos e testes | `pnpm typecheck`, `pnpm lint` e `pnpm test` verdes |

Não verifiquei no Teatro: o autoteste novo (`checkTheater`, no `.exe` com WebView2; este worktree é Linux), o Clef de verdade ao vivo, a legibilidade do ritmo em replays reais
no `.exe`, e a direção dos botões contra a câmera isométrica (a bússola usa ↑ ← → ↓ da tela, não projeta os eixos do mundo).

Não verifiquei: teclas físicas do teclado (só eventos sintéticos no mesmo `keydown`), o instalador (`tauri build` com bundle NSIS) e o app com uma
chamada de rede ao vivo em tempo real (as decisões do Clef na janela vieram do cache; o pipeline de rede é o mesmo do benchmark, já exercitado com a API).

## Verificação do relógio da plataforma e da verdade da tela (2026-10-17)

Pedido do dono: "a jogabilidade ainda tá estranha (...) ele não sabe que está num tronco em movimento que logo vai sair do mapa (...) também pode melhorar para que a decisão dele sempre seja mostrada corretamente".
O diagnóstico e as medidas do modelo estão em [07](07-experimentos.md); aqui, o que a tela mostrava errado e o que mudou.

| O que a tela mostrava | O que fazia de fato | Agora |
|---|---|---|
| A barra maior não era a jogada escolhida em **22%** das decisões gravadas (21 de 95): probabilidades conjuntas contra uma cascata de argmax | A escolha segue as respostas, uma a uma | Barras **pela rota tomada** (`barsOf`): a acesa é sempre a maior; um caminho fechado mostra ← → e a pausa e um bloco no lugar do ↑; a legenda e o card do painel dizem o ramo e a certeza dele. Os registros do benchmark seguem com as conjuntas |
| "Go straight" numa rodada recusada, retida ou que saiu de uma plataforma; a razão aparecia por ~0,2 s e a conversa nunca a trazia | O controlador recusou e a galinha ficou parada ou voltou | A conversa traz "controller: …" sob a jogada; o anel da jogada real e a legenda já aparecem **durante a leitura** ("next: …"); `RouteStep` diz o motivo (`gap`/`no_rest`, `refused`/`unsafe_here`/`edge`/`no_way`, `leave`) |
| "waiting for a vehicle to pass" com a casa da frente vazia (5% dos passos de espera) | Esperava porque a **linha depois** (ou um trem) bloqueava | `no_rest`: "the cell is clear, but a vehicle would reach it before the chicken could go on · waiting 3/15" e o trem é chamado de trem |
| O card do painel e o balão de pensamento destacavam a jogada **feita**, com a probabilidade conjunta dela | A jogada feita é o primeiro salto do controlador | Os dois seguem a jogada **escolhida** (`winnerOf`) |
| "· when clear" sempre que as respostas diziam que as coisas passam | O controlador às vezes atravessava de imediato | Só quando o controlador **de fato esperou** |
| Nada dizia que o tronco levava a galinha à borda | A galinha esperava e saía do mapa | Contador na galinha (`EdgeClock`, do jogo ao vivo), a linha de chão e a 4ª pergunta na conversa, e a manobra "Get off the platform" |

**Verificação no navegador** (Chromium, Playwright, um **modelo de mentira** respondendo a `/__ccr/run`: nenhuma chamada saiu e as probabilidades das capturas **não são resultado de nada**; ritmo Slow para a resposta ficar na tela): seed 6 inteira, com a bússola respondendo e o contador na galinha a 1,8 s, depois a 0,9 s em vermelho; o caminho fechado com o ↑ como bloco tracejado, → aceso a 60% e a legenda "the way ahead is closed 30% · controller next: refused, no way to an opening on the right within 8 hops; waiting where it is safe"; a manobra "Get off the platform" com 85% na pausa, "refused, no way off within 8 hops" e as três perguntas do caminho "not needed"; a espera com a casa livre ("the cell is clear, but a vehicle would reach it…"). O contador estava sobre o botão de pausa na primeira posição e foi para baixo do botão esquerdo.

**Replay real do cache**, no app de verdade e sem modelo de mentira (seeds 6, 7 e 8, Clef-flash): terminam em **9, 8 e 183 ruas** ("Wandered off the road", "Hit by a car", "Stuck: no new row in 60 decisions"), com **0 chamadas ao bridge** e "This game: 0.0 neurons"; no bench, `--daily-neurons 0` dá 272 acertos de cache e 0 chamadas. A seed 8 era 39 ruas, presa de frente para vitória-régia (2026-10-17, [07](07-experimentos.md)); foi gravada inteira, sem o teto de 300 decisões do bench, para o app a reproduzir sem chamar o modelo. O app lista **6 a 8**. (Um servidor de desenvolvimento que já carregou o cache antes de ele ser regravado o guarda em memória e erra: reiniciá-lo.)

Não verifiquei: o autoteste do `.exe` com WebView2 (este worktree é Linux), o Clef ao vivo com a tela aberta, e o **tempo real**.

**Pergunta aberta: o tempo real.** Em passo a passo (o padrão) o mundo espera o modelo e o movimento sai no mundo em que foi pedido. Em tempo real o movimento é calculado no mundo do pedido e jogado no mundo de agora (`session.ts`: `executor.start` roda na observação antiga), e os contadores `n/15` e `12 saltos` contam **quadros**, não segundos; uma tora pode ter levado a galinha entre o pedido e a resposta e o que se mostra deixa de ser o que se joga. Opções: refazer o `start` na observação nova, descartar a resposta se a coluna ou a linha mudou, ou mostrar "stale by N ticks". Não decidido.

## Pré-requisitos (todos instalados em 2026-10-14)

Node 24, pnpm 10, MSVC (Visual Studio com C++), WebView2 155, Rust 1.99 via `rustup` (instalação em nível de usuário, reversível com `rustup self uninstall`).

## Perguntas abertas

1. Instalador (NSIS) e assinatura de código, se o app for distribuído: fora do escopo por ora.
2. Em build empacotado, as credenciais deveriam migrar do `.env` para o chaveiro do SO (`keyring`).
3. O `dist/` do app embute os assets do Evan: ver a nota de IP em [10](10-seguranca-e-licencas.md) antes de distribuir qualquer binário.
