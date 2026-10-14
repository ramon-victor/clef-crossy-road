# 04 · Núcleo do jogo (`@ccr/core`)

> **Status:** implementado (Fase 1), 60 testes passando · **Verificado em:** 2026-10-14
> **Fonte das regras:** [EvanBacon/Expo-Crossy-Road](https://github.com/EvanBacon/Expo-Crossy-Road) na revisão `6f2e84e` (2026-03-25), lido por inteiro em `src/` (engine, mapa, jogador, linhas, nós, ajustes). Código em `packages/core/src/`.

## Por que não usar a engine original

| Problema no original | Consequência | Solução no core |
|---|---|---|
| `Math.random` sem seed em linhas, carros, toras, pads | Mapas não reproduzíveis | PRNG sfc32 com seed, um fluxo por linha |
| Movimento por frame; `dt` passado e ignorado | Velocidade depende do monitor | Passo fixo de 60 Hz, contado em ticks |
| Linhas são `Group` do Three; colisão lê `mesh.position` | Não roda sem GPU/DOM | Entidades em estruturas simples (`Mover`) |
| `setTimeout` para o semáforo do trem | Depende do relógio de parede | Contagem de ticks (180) |
| Engine depende de `Dimensions` do React Native e do GL do Expo | Não roda headless | Render separado (`@ccr/render`, Fase 3) |

Desempenho medido na Fase 1 (Node 24, uma máquina de desenvolvimento): **0,3 a 2 milhões de passos de decisão por segundo**, sem GPU. O gargalo do benchmark será a rede.

## Invariantes (cobertas por testes)

1. Mesma seed + mesma sequência de ações ⇒ snapshots idênticos (hash comparado, incluindo clones).
2. O resultado não depende da ordem em que as linhas são consultadas (cada linha tem seu fluxo de PRNG).
3. Nenhuma chamada a `Math.random`, `Date`, `performance`, timers, DOM, rede, `crypto`, `Intl`, Three ou import dinâmico em `src/` (teste de pureza); além disso o `tsconfig` do core não carrega tipos de DOM nem de Node.
4. Unidades internas: tiles e tiles/tick; qualquer coisa que um agente leia sai em colunas/s.
5. Ação inválida (árvore) vira no-op e é contada em `invalidMoves`.

## Eixos

- `z`: índice da linha, cresce para a frente. `x`: coluna, **exatamente como no original, em que "esquerda" da tela é +x**.
- Para agentes e humanos: `col = −x` (direita da tela é +col) e `dz = z − linha do jogador`. A conversão acontece só em `observe()` ([06](06-observacao-e-prompts.md)).
- Ações: `hop_left` soma +1 a `x` (`col −1`), `hop_right` soma −1 (`col +1`), como `moveWithDirection` do original.

## Regras portadas (todas lidas no código; entre parênteses o arquivo de origem)

**Mapa (`CrossyGame.ts`, `Row/*.ts`)**

| Regra | Valor |
|---|---|
| Linhas 0–4 | Grama **sólida**: árvores em todas as colunas −7..7. O herói nunca volta além da linha 5 |
| Linhas 5–9 | Grama com paredes de árvores em \|x\| ≥ 5 e **1–3 árvores internas aleatórias**. `Fill.empty` existe no original, mas nenhum código o consulta, então só `solid` difere de `random` |
| Linhas ≥ 10 | Tipo uniforme entre grama, "roadtype" e água; "roadtype" vira trilho com 25%. Resultado: grama 1/3, rua 1/4, trilho 1/12, água 1/3 (testado) |
| Árvores internas | Colunas −4..4 sem a 0, até `round(2·rand)+1` árvores, `p = 0,4` por coluna. O contador também sobe quando uma árvore é vetada pelo vitória-régia |
| Rua | 1–2 carros, velocidade 0,02–0,08 tiles/tick, uma direção por linha, início em −6·dir, espaçamento 5–8; volta em ±11 |
| Larguras dos carros (bounding box dos `.obj`) | police 2, blue_car 1, blue_truck 3, green 2, orange 2, purple 2, red_truck 3, taxi 2 |
| Água, linhas pares | 2–3 vitórias-régias imóveis em inteiros, a partir de −4 ou −3, espaçamento 2–3. Se nenhuma cair numa coluna livre da grama anterior, a primeira vai para uma coluna livre (mapa vencível). A grama seguinte não planta árvore sobre um pad |
| Água, linhas ímpares | 2–3 toras, velocidade 0,02–0,07, largura 1–4 (modelos 0–3), espaçamento 5–8 |
| Trilho | 1 trem por linha, **0,8 tiles/tick (48 tiles/s)**, volta em ±110, 2 ou 3 vagões do meio com 50% cada (largura 20 ou 25) |
| Semáforo | Toca por 180 ticks (3 s) a cada vez que o trem dá a volta; período do trem 276 ticks (4,6 s) |

**Jogador (`GameEngine.ts`, `CrossyPlayer.ts`, `GameSettings.ts`)**

| Regra | Valor |
|---|---|
| Início | `x = 0`, `z = 8` (`startingRow`), largura do herói 0,7 |
| Salto | 2 tweens de 0,1 s = **12 ticks**: 75% do caminho no primeiro, o resto no segundo, ambos `ease-out` (`Power1.easeOut`, `p·(2−p)`) |
| Posição durante o salto | A **posição de colisão** é a do tween; a posição lógica (destino) vale desde o comando |
| Entrada durante um salto | Termina o salto em curso (crédito de score) e começa o novo; entradas nunca são descartadas |
| Para frente/trás | `x` é arredondado com `Math.round`; para os lados, `x ± 1` sem arredondar (relevante sobre toras) |
| Bloqueio | `treeCollision`: trunca o destino (`\|0`) e só linhas de grama bloqueiam. Bloqueado ⇒ o herói fica parado |
| Score | `max(⌊z⌋ − 8, 0)`, creditado **só quando um salto termina** e o herói está vivo; é o máximo já alcançado |
| Fim por limites | `x < −5` ou `x > 5`, ou `z < 0`; só verificado fora de um salto |

**Colisões (`Row/Road.ts`, `Water.ts`, `RailRoad.ts`)** — ordem dentro de cada tick: salto, perigos da linha do herói, depois carona/limites.

| Perigo | Condição |
|---|---|
| Carro | `round(z)` = linha do carro, herói vivo, `\|x − carro.x\| < 0,25 + largura/2`, **mesmo durante o salto**; no tick em que o carro dá a volta não há checagem |
| Água | Fora de salto e sem carona, `round(z)` = linha d'água ⇒ procura tora/pad com mesma meia-largura (a última sobreposta vence); sem plataforma ⇒ afoga |
| Tora/pad | Carrega o herói (`x += velocidade` por tick) até o próximo comando. Pad tem meia-largura 0,75 |
| Trem | Só **fora de salto** e fora do tick da volta; zona letal `\|x − trem.x\| < 0,25 + largura/2` (10,25 ou 12,75), **centrada na origem do trem** |

## Desvios intencionais do original

| # | Desvio | Motivo |
|---|---|---|
| D1 | A posição de carros, toras e trens é função fechada do tick global; toda linha "já estava andando" desde o tick 0. No original a linha começa a andar quando é gerada (disparada pela câmera) | Mesmo mapa e mesma fase para qualquer política |
| D2 | Um fluxo de PRNG por linha (`seed`, `z`, domínio) | Conteúdo independente da ordem de geração |
| D3 | Linhas sob demanda, sem câmera nem pool de 20 linhas | A câmera é assunto do render |
| D4 | Fase inicial do trem sorteada em [−110, 110). No original é a posição que o objeto do pool tinha (0 no primeiro uso) | Fase reproduzível e não dependente do histórico do pool |
| D5 | Salto discretizado a 60 Hz (k/6 por tick). O original usa tempo real do GSAP | Determinismo; coincide em tela de 60 Hz |
| D6 | Nova entrada durante o salto não deixa tweens antigos brigando | O original reposiciona o herói mas não cancela as animações anteriores |
| D7 | Sem animações, partículas, som, vibração, afundamento e o carro "carregando" o corpo após a morte | Visual, só depois do fim |
| D8 | Bugs do original não reproduzidos: `TweenLite` sem import, `entities[0]` em linha sem entidades | Não afetam a jogabilidade lógica |

## Peculiaridades preservadas de propósito

- A zona letal do trem é **simétrica em torno da origem**, mas o corpo do trem fica em [origem − 2,4; origem + 17,4] (2 vagões). Com a velocidade positiva, o herói pode morrer antes de o corpo o alcançar. Por isso a observação reporta a zona letal (`col`, `half_extent`), não o desenho. O renderer deve desenhar o corpo a partir da origem.
- A janela letal do trem é curta: 20,5 tiles a 0,8 tiles/tick ≈ 26 ticks (0,43 s). O semáforo liga ~2,1 s antes de o trem chegar e continua ligado ~0,5 s depois que ele passa.
- Carros, toras e pads usam a mesma meia-largura de acerto (`0,25 + largura/2`), e a largura vem de `Math.round` da bounding box do modelo. O pad tem 0,5 de largura real e `Math.round(0,5) = 1` em JavaScript.
- Não existe morte por ociosidade nem "águia": o jogo original não pune esperar.

## API

```ts
const game = new Game({ seed: 1042 });        // uint32
game.step("hop_forward");                      // aplica a ação e avança 12 ticks (DECISION_TICKS)
game.act("hop_left"); game.advance(5);         // controle fino (tempo real / latência injetada)
const obs = observe(game, { behind: 3, ahead: 8 });   // só fatos físicos (ADR-0005)
const snap = game.snapshot();                  // dados puros para render e hash
const future = game.clone();                   // para o baseline de look-ahead
hashValue(snap);                               // comparação de determinismo
```

## Medição inicial com políticas triviais (2026-10-14)

2.000 seeds, teto de 400 decisões, script descartável fora do repo (o `apps/bench` da Fase 2 refaz isso com IC de 95%):

| Política | Ruas (média / mediana / p90 / máx) | Mortes |
|---|---|---|
| `always-forward` | 4,28 / 3 / 7 / 22 | água 89%, carro 8%, trem 2,5% |
| aleatória | 2,77 / 2 / 4 / 12 | água 60%, carro 27%, trem 7%, limites 3%, sobreviveu 3% |
| 60% frente, resto aleatório | 3,76 / 3 / 6 / 21 | água 77%, carro 19%, trem 4% |

Leitura: o piso honesto é `always-forward` (≈ 4,3 ruas), e a água é o principal assassino: andar reto quase nunca acerta uma plataforma.

## Perguntas abertas

1. Quantos ticks por decisão (`DECISION_TICKS = 12`, um salto completo) é a melhor escolha para o Clef? A sonda de [00](00-viabilidade.md) usou "0,3 s" no prompt (18 ticks). Decidir na Fase 2.
2. Janela de observação (3 linhas atrás, 8 à frente) é suficiente? Medir tokens e desempenho.
3. A posição do corpo do trem em relação à origem foi deduzida das bounding boxes; confirmar visualmente na Fase 3.
