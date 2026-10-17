# 11 · Lições dos 13 jogos controlados pelo Jev

> **Status:** estudo concluído, aplicado em [ADR-0010](adr/0010-palavras-regras-e-executor-de-manobras.md); resultado medido em [07](07-experimentos.md) (10,05 ruas em 40 partidas) · **Verificado em:** 2026-10-17 · **Método:** leitura dos READMEs e do código de cada repositório pela API do GitHub; nenhum código foi copiado nem executado, nenhuma chamada de modelo foi feita

O Jev é o modelo "System One" da TypeSafe AI (o Clef é o mesmo tipo de modelo, e a API é a mesma: `state` + perguntas `choice`, `noul` e `score`, com probabilidades). Os 13 repositórios que o dono indicou
resolvem o mesmo problema que nós: fazer um modelo de decisão jogar. Eles são estudos de terceiros, de qualidade desigual, e poucos medem contra um jogador roteirizado (o Doom de `jev-plays-doom` e o Pong de `pong-jev` medem); o que vale aqui é o padrão que se repete.

## O que cada um faz

| Jogo | Repositório | O que importa para nós |
|---|---|---|
| Doom (navegador) | [lukaske/jev-doom-agent](https://github.com/lukaske/jev-doom-agent) | Quatro `choice` independentes na mesma chamada (movimento, olhar, atirar, usar); controlador local executa a "macro"; chamada falha ou de baixa confiança aparece como `FALLBACK`; a política offline se declara "NOT JEV" |
| Doom (Freedoom) | [olivier-motium/jev-doom](https://github.com/olivier-motium/jev-doom) | Modos rotulados ("observable" × "assisted"), contadores do avaliador escondidos do modelo, o código monta as opções legais e executa os motores, teto de gasto persistente |
| Doom | [tirukovelamanoj/jev-plays-doom](https://github.com/tirukovelamanoj/jev-plays-doom) | **A experiência mais útil**: opções com a regra escrita (`rule`) fazem 6,20 abates, só com o propósito (`intent`) fazem −0,60; `Choice` + `Noul` na mesma chamada; `--conf-floor` troca baixa confiança por um jogador roteirizado; 20 partidas, seed fixa. **Com a regra escrita o Jev empata com a mira roteirizada (6,55 contra 6,55 abates)**: o resultado é o da regra, não de descoberta |
| Super Mario Bros. | [fhshaik/typesafe-mario](https://github.com/fhshaik/typesafe-mario) | RAM → JSON por objeto; o código calcula a aritmética de tempo e entrega fatos tipados (`jump_must_start_this_decision`); `Choice` + `Noul` + `Score`; atraso de resposta medido entra no estado; "sem regra de recuperação que sobrescreva o Jev" |
| Tetris | [pedroarruda07/jev-plays-tetris](https://github.com/pedroarruda07/jev-plays-tetris) | O modelo escolhe a **posição final** entre as alcançáveis; cada opção traz o tabuleiro resultante e métricas; o planejador executa as teclas; resposta atrasada é descartada; o pedido exato aparece no terminal e no console |
| StarCraft | [phyous/tsai-sc](https://github.com/phyous/tsai-sc) | Intenção (`Economy`, `Engage`...) e depois uma ação por categoria, candidatos montados pelo código; jogo pausado durante a inferência; memória do que foi visto; probabilidades mostradas, nunca "chance de ganhar" |
| Pokémon FireRed | [anxkhn/JevPlaysPokemon](https://github.com/anxkhn/JevPlaysPokemon) | Só ações legais, com descrição; resposta validada (probabilidades somam 1); nada substitui o modelo em baixa confiança; registro com pedido e resposta exatos |
| Civilization II | [phyous/tsai-civ2](https://github.com/phyous/tsai-civ2) | Vetores de `choice` por domínio; o guia de estratégia vai no pedido, com revisão numerada; lições de campanha: o prompt foi corrigido depois de falhas observadas |
| Minecraft | [Hardel-DW/jev.mods](https://github.com/Hardel-DW/jev.mods) | Camadas: código determinístico (observação, memória, física), um LLM estrategista chamado raramente, o Jev como **reflexo** a cada tick entre as primitivas disponíveis; resposta descartada se o bot se mexeu; diário porque o Jev não lembra entre chamadas; perguntas fixas por sistema |
| Pong | [safzanpirani/pong-jev](https://github.com/safzanpirani/pong-jev) | **Palavras no lugar de números** ("far below my paddle"), com teste de que o pedido não tem dígitos; `--aim` diz onde a bola vai chegar; abstenção por confiança; chamadas sobrepostas com número de sequência (idade da decisão 196 → 111 ms) |
| Snake | [tanayvasishtha/Slither-Me-Jev](https://github.com/tanayvasishtha/Slither-Me-Jev) | Uma chamada por tick com uma pergunta por cobra; só jogadas legais, cada uma com fatos (distância da comida, da cabeça inimiga, espaço livre); "personalidade" como texto |
| Chrome Dino | [skpanigrahy/jev-t-rex-runner](https://github.com/skpanigrahy/jev-t-rex-runner) | **Uma manobra por obstáculo** (`jump`, `duck`, `keep_running`) e o navegador cuida do tempo em função da velocidade; decisão que chega tarde é pulada; confiança mínima 0,5 |
| Multijogo | [shantanugoel/jev-games](https://github.com/shantanugoel/jev-games) | Mario com `Choice` (movimento) + três `Noul` (começar o pulo, pulo curto sob teto baixo, manter o pulo) na mesma chamada; o código compõe os botões; memória de transições da partida com eventos ("possibly_blocked_horizontally"); jogador roteirizado para testar sem gastar |

## O que se repete

1. **Estado pequeno, em palavras ou campos prontos.** Ninguém manda ao modelo uma conta que ele precise fazer; o código subtrai, ordena e classifica, e o modelo recebe a relação. O `pong-jev` cita as notas do `jev-1.13` (fraco em aritmética, contagem e magnitudes; detalhe sem relação custa precisão).
2. **A opção escreve a regra.** Onde há comparação entre uma versão com a fronteira escrita e outra só com o propósito (Doom), a primeira joga e a segunda não.
3. **O modelo escolhe a manobra; o código executa e dá o tempo.** Dino, Tetris, Doom, StarCraft e Minecraft separam "o que fazer" de "quando e como".
4. **Resposta velha vale pouco.** Descartar ou replanejar na chegada; estado com o atraso medido; previsão no lugar da posição atual.
5. **Mais de uma pergunta pequena na mesma chamada** quase não custa tempo (Mario, Doom, StarCraft).
6. **Abstenção e rótulo.** Baixa confiança vira um fallback visível; o que não é o modelo diz que não é.
7. **Memória no estado**, porque cada chamada começa do zero.

## O que levamos e o que não

| Padrão | Estado |
|---|---|
| Palavras em vez de números | Aplicado: encoder `lanes` |
| Regra com fronteira nas opções | Aplicado: manual `rules` |
| Manobra + executor | Aplicado: estratégias `maneuver` e `graph-maneuver`, com `exec-cross` (6,08 ruas) como piso |
| Resposta velha / atraso | O executor lê o mundo ao vivo; o modo tempo real do app usa o mesmo caminho |
| Várias perguntas pequenas | Aplicado: estratégia `graph` (duas perguntas exclusivas na mesma chamada). Foi o que fez a decisão virar um passo seguro: a pergunta única de cinco opções escolhia a última opção "verdadeira" |
| Abstenção por confiança | Fica como métrica e como ablação nos registros já gravados (sem chamar a API) |
| **Só jogadas legais, cada uma com a consequência** (Snake, Tetris, Pokémon) | **Não levamos**: é julgamento por jogada, que a [ADR-0009](adr/0009-percepcao-memoria-e-julgamento.md) proíbe. Seria um nível "assistido" próprio, só se o dono quiser |
| Estrategista LLM raro (Minecraft) | Fora de escopo: o jogo é decisão a decisão e o experimento é sobre o Clef |

## Estagnação, caminho e contexto: o que os 13 fazem e o que fizemos (2026-10-15)

A condição de [ADR-0010](adr/0010-palavras-regras-e-executor-de-manobras.md) estagnava em 58% das partidas. A comparação que orientou a correção ([ADR-0011](adr/0011-controlador-com-rota-e-tres-consultas.md)):

| Problema | O que os outros jogos fazem | O que tínhamos | O que fizemos |
|---|---|---|---|
| **Preso, em laço** | Doom: `motion.stuck` no estado, instrução "se preso, mude o movimento ou a vista" e o motor local dá ré e vira sozinho; Mario: `stalled_frames` e `recent_control.outcome` com "a ação que não bloqueou falhou"; StarCraft: células visitadas e "revisitar continua disponível"; jev-games: eventos `possibly_blocked` na memória | `blocked_last_two` e `no_new_row_for_a_while`, que nenhuma opção lia | `recently_failed` por lado (o desvio que o controlador devolveu desde a última linha nova) **dentro da regra** da pergunta `around`; `last_maneuver` diz como a anterior terminou |
| **Caminho** | Doom `nextWaypoint`, Tetris (busca de caminhos até a posição final), Minecraft (pathfinding), StarCraft (o jogo acha o caminho): o modelo escolhe o destino, o código acha a rota | manobras de um passo: para "voltar, direita, direita, frente, frente" o modelo tinha de encadear cinco decisões | `detour_left`/`detour_right`: busca em largura sobre as palavras (profundidade 8), refeita a cada 0,2 s |
| **Contexto** | Doom até 32 entidades e 64 linhas; Tetris o tabuleiro e até 255 candidatos; Civ2 um guia revisado em cada pedido; Pong deliberadamente mínimo | ~1.350 tokens de 24.000 possíveis | ~1.750 tokens: **a largura toda** da linha da frente e da própria em palavras, **exemplos resolvidos** e a memória de fronteira; nada de volume solto (o Pong avisa que detalhe sem relação custa precisão) |
| **Regra composta** | Doom `rule`: um limite por opção; Mario: uma pergunta `Noul` para cada decisão de salto, não uma regra de duas condições | uma pergunta com "A, ou B e C" | **uma consulta de um campo por pergunta**; o código junta as respostas (o modelo errou 100% das águas paradas com a regra de dois campos) |
| **Exemplos resolvidos** | jev-games Mario: "dx79 → false; dx35 → true" na instrução | nenhum | oito a dez linhas "trecho do estado → resposta" em cada pergunta |
| **Instrução refeita depois de ver a falha** | Civ2: revisões v4 e v5 do guia a partir dos registros | — | o texto das perguntas foi refeito três vezes olhando as respostas gravadas (86% → 85% → 94% de concordância) |

O que **não** levamos: a lista de candidatos com a consequência de cada um (Tetris, Snake, Pokémon), que é julgamento por jogada.

## O tronco que leva a galinha para fora do mapa (2026-10-17): o que levamos e o que não

Segunda leitura dos mesmos 13 repositórios (código pela API do GitHub, nada executado), agora para a pergunta "como um fato que acaba o jogo em um instante chega ao modelo, e como se mostra quem decidiu":

| Projeto | O que faz | O que fizemos |
|---|---|---|
| `typesafe-mario` | O código calcula o **prazo** e entrega um fato tipado (`jump_must_start_this_decision`, `takeoff_deadline_frames`, com o atraso do modelo já descontado), repetido na instrução, na regra da opção e numa pergunta `Noul` própria (`jump_needed`) | `chicken.edge_in` (o prazo da plataforma, em quatro palavras) e a pergunta `ride`, só com a plataforma sob a galinha. **Não** descontamos o atraso do modelo: em passo a passo o mundo espera |
| `olivier-motium/jev-doom` | Uma pergunta própria (`dodge_question`: `carry_on`, `left`, `right`) **só aparece quando o perigo existe**; cada registro traz `override_reasons[]` e a tela junta as sobreposições numa linha de aviso | `ride` só entra no pedido numa plataforma (o resto dos pedidos fica igual, e o cache vale); `RouteStep` traz o motivo de cada espera, recusa e saída, e a conversa o diz sob a jogada |
| `pong-jev` | **Palavras em faixas** ("about to reach my paddle", "little room to move up"), sem números; a fonte de cada decisão (`jev`, `heuristic`, `fallback`) ao lado dela | As faixas de `edge_in`; o passo do controlador é marcado como tal, nunca como a escolha do modelo |
| `jev-t-rex-runner` | O modelo só escolhe a manobra e o navegador dá o tempo; resposta tardia é **pulada**, sem substituto | É o que o controlador já faz; a decisão tardia em tempo real continua pergunta aberta ([08](08-ui-desktop.md)) |
| `tirukovelamanoj/jev-plays-doom` | Limites numéricos na regra da opção funcionam (6,20 abates), só o propósito não (−0,60) | Mesmo achado, de novo: **a redação decide** ([07](07-experimentos.md): pedindo o julgamento "vai para fora do mundo?" 3 de 12; pedindo "a palavra é `a_moment`?" 12 de 12). Sem números: a faixa já é a palavra |

**O que não levamos, e por quê.** `jev-games` (Mario) e `Slither-Me-Jev` **inventam probabilidades** (0,85/0,15; 0,7 e 0,3) para o que não foi o modelo, e mostram essas barras; nós não: o passo do controlador não tem barras. O painel do `jev-games` tem uma linha `override` que nunca é preenchida, e o `typesafe-mario` grava a ação do modelo, não a executada, quando o código troca; nós **gravamos e mostramos as duas** (a escolha e o passo). O `Slither-Me-Jev` oferece ao modelo as jogadas que matam, escritas como "wall, death": é a consequência por jogada, que a [ADR-0009](adr/0009-percepcao-memoria-e-julgamento.md) proíbe.

## Perguntas abertas

- Quase nenhum dos 13 mede o jogador contra um roteirizado que lê a mesma vista (o Doom empata com a mira roteirizada). Não sabemos quanto do resultado dos outros é do modelo e quanto é do código ao redor; é o que `exec-cross`, `exec-rules` e `rule-lanes` medem para nós.
- O Jev e o Clef são o mesmo tipo de modelo, mas **não** confirmamos que sejam o mesmo modelo: o que vale para um pode não valer para o outro (por isso as sondas antes das partidas).
