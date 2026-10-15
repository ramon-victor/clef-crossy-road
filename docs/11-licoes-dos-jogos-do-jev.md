# 11 · Lições dos 13 jogos controlados pelo Jev

> **Status:** estudo concluído, aplicado em [ADR-0010](adr/0010-palavras-regras-e-executor-de-manobras.md) · **Verificado em:** 2026-10-15 · **Método:** leitura dos READMEs e do código de cada repositório pela API do GitHub; nenhum código foi copiado nem executado, nenhuma chamada de modelo foi feita

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
| Manobra + executor | Aplicado: estratégia `maneuver`, com `exec-cross` como piso |
| Resposta velha / atraso | O executor lê o mundo ao vivo; o modo tempo real do app usa o mesmo caminho |
| Várias perguntas pequenas | Fica para depois, só se a sonda de `rules` não bastar |
| Abstenção por confiança | Fica como métrica e como ablação nos registros já gravados (sem chamar a API) |
| **Só jogadas legais, cada uma com a consequência** (Snake, Tetris, Pokémon) | **Não levamos**: é julgamento por jogada, que a [ADR-0009](adr/0009-percepcao-memoria-e-julgamento.md) proíbe. Seria um nível "assistido" próprio, só se o dono quiser |
| Estrategista LLM raro (Minecraft) | Fora de escopo: o jogo é decisão a decisão e o experimento é sobre o Clef |

## Perguntas abertas

- Quase nenhum dos 13 mede o jogador contra um roteirizado que lê a mesma vista (o Doom empata com a mira roteirizada). Não sabemos quanto do resultado dos outros é do modelo e quanto é do código ao redor; é o que `exec-cross`, `exec-rules` e `rule-lanes` medem para nós.
- O Jev e o Clef são o mesmo tipo de modelo, mas **não** confirmamos que sejam o mesmo modelo: o que vale para um pode não valer para o outro (por isso as sondas antes das partidas).
