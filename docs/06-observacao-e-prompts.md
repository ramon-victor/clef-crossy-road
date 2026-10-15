# 06 · Observação e prompts

> **Status:** rascunho; guiado pela sonda de 2026-10-14 · **Verificado em:** 2026-10-15 · **ADRs:** [0005](adr/0005-regra-de-justica-da-observacao.md), [0009](adr/0009-percepcao-memoria-e-julgamento.md), [0010](adr/0010-palavras-regras-e-executor-de-manobras.md), [0011](adr/0011-controlador-com-rota-e-tres-consultas.md)

## Regra de justiça

O experimento mede o modelo, não a nossa lógica. Por isso a `Observation` só pode conter **fatos físicos medidos**.

| Permitido | Proibido |
|---|---|
| Tipo de terreno de cada linha (grama, rua, trilho, água) | Rótulos "seguro", "perigoso", "colisão iminente" |
| Posição, largura e velocidade (tiles/s) de carros, toras e trem | Lista de movimentos válidos ou bloqueados calculada por nós |
| Colunas ocupadas por árvores, limites laterais | Tempo até a colisão com o jogador |
| Fase do semáforo do trem (ligado/desligado) | Qualquer campo que dependa da ação candidata |
| Coluna e linha do jogador, e o que há sob ele | A decisão de uma política anterior |

Árvores aparecem como colunas ocupadas (geometria), não como "movimento bloqueado". Um movimento inválido vira no-op
no core e entra na métrica de movimentos inválidos. Um teste congela as chaves permitidas do schema.

Mudar a **representação** (JSON → grade → imagem → JSON com colunas relativas) é permitido, mas aparece no relatório como condição própria.

**Além da `Observation`** (a [ADR-0009](adr/0009-percepcao-memoria-e-julgamento.md)): o modelo também pode receber o que um jogador percebe e lembra, em três níveis que o relatório mostra: `now` (os fatos do instante), `memory` (mais as últimas jogadas e o que cada uma fez, as linhas cruzadas e há quantas jogadas não ganha linha) e `forecast` (mais onde cada objeto estará daqui a 0,2 s). Julgamento ("seguro", "morre se", tempo-até-colisão, "alcançável", jogadas válidas) continua proibido.

**Níveis de ajuda** (a [ADR-0010](adr/0010-palavras-regras-e-executor-de-manobras.md)): além de `now`, `memory` e `forecast`, o nível `words` (o encoder `lanes`) entrega o mesmo conhecimento já comparado pelo código, dito como a palavra do que ocupa cada casa. O manual `rules` (as opções citam os campos e as palavras) e a estratégia `maneuver` (um executor dá o salto) são condições próprias, e o relatório mostra tudo em "Sees": `words`, `words + rules`, `words + rules + executor`.

## Observação (E0, JSON)

```json
{
  "player": { "col": 0, "on": "grass" },
  "bounds": { "min_col": -4, "max_col": 4 },
  "rows": [
    { "dz": -1, "kind": "grass", "blocked_cols": [] },
    { "dz": 0,  "kind": "grass", "blocked_cols": [-1] },
    { "dz": 1,  "kind": "road",  "vehicles": [ { "x": 0.3, "w": 1.2, "speed_tiles_per_s": 3.0 } ] },
    { "dz": 2,  "kind": "water", "platforms": [ { "kind": "log", "x": 1.0, "w": 3.0, "speed_tiles_per_s": 1.0 } ] },
    { "dz": 3,  "kind": "rail",  "train": { "x": -40, "w": 8, "speed_tiles_per_s": 48 }, "warning_light": "on" }
  ]
}
```

- Linhas em **array**, sempre com `dz` relativo ao jogador, nunca como chaves de objeto ([05](05-integracao-clef.md)).
- Janela: 3 linhas atrás e 8 à frente (a ajustar). `x` é absoluto; a variante `x_rel = x − player.col` é testada como condição à parte.
- Unidades explícitas (`tiles`, `tiles/s`). O core usa tiles/tick internamente; a conversão é feita ao observar.

## Encoders

| ID | Representação | Observação |
|---|---|---|
| E0 | JSON acima | Condição base |
| E1 | Grade ASCII (13 colunas) centrada no jogador, mais os números exatos de cada linha | Implementado e avaliado no gate: indistinguível de E0 |
| E2 | **Vista de cima em PNG**, 416×384 px (13×12 quadrados de 32 px), desenhada só a partir da observação | Implementado (`packages/agent/src/image.ts`) e **avaliado: significativamente pior** que "sempre em frente" (−0,42 ruas) e com probabilidades quase uniformes. ~159 tokens de imagem (`(w/32)·(h/32)+3`) |
| E3 (`json-rel`) | O mesmo JSON, com toda coluna medida **a partir da coluna da galinha**: `dcol` no lugar de `col` e `blocked_dcols` no lugar de `blocked_cols` (`player.col` continua absoluto, por causa da borda do mundo) | Implementado e **avaliado em 40 seeds: indistinguível de "sempre em frente"** (3,20 contra 3,30) e sem sinal dentro da água (AUC 0,54). ~1.163 tokens por decisão |
| E4 (`view`) | A tela inteira como mapa de texto centrado na galinha (colunas −5 a +5, linhas dz −3 a +8), com os números exatos dos objetos e a memória em frases | Implementado e **avaliado em 90 estados (sonda)**: sem ganho na água; a memória em texto quase não tirou o modelo da árvore (90% repetem) |
| E5 (`view-fx`) | `view` mais um segundo mapa dos objetos que se movem, daqui a 0,2 s | Idem: sem ganho na água (AUC 0,41) |
| E6 (`json-fx`) | `json-rel` mais a coluna de cada objeto daqui a 0,2 s (`dcol_after`) e a memória em campos (`last_moves`, `rows_crossed`, `moves_since_new_row`) | **O Clef do app.** 100 partidas: 3,73 ruas, igual a `always-forward`. Na sonda, tirou o modelo do laço da árvore em metade dos casos |
| E7 (`lanes`) | O código compara e diz **em palavras** o que ocupa as casas onde a galinha poderia pousar: `forward.lands_on`, `…_after_stepping_left/right` (um salto depois), `sideways.left/right_lands_on`, `backward.lands_on`, `chicken.stays_on`; mais o tipo das linhas 2 a 4, para onde as coisas se movem, a posição no mundo e a memória em frases. Vocabulário fechado, **nenhum dígito**, nenhuma palavra de julgamento | `packages/agent/src/lanes.ts`. Um leitor roteirizado só destas palavras (`rule-lanes`) faz **19,7 ruas** (100 seeds, grátis), então a informação basta. O que há embaixo da galinha parada (`stays_on`) olha 0,4 s à frente (os próximos dois passos), porque um carro que chega logo depois do primeiro ainda a acerta. ~1.115 tokens por decisão no estilo `rules` (medido na sonda) |
| E8 (`moves`) | As mesmas palavras, **agrupadas sob o nome de cada jogada** (`hop_forward.lands_on`, `hop_left.lands_on` e `hop_left.then_hop_forward_lands_on`, `stay.stands_on`...), para que as chaves do estado sejam as palavras das opções; `chicken` (posição no mundo, para onde a plataforma leva) e a memória. **Sem o nome do tipo da linha**: a palavra `water` ao lado de `lands_on: log` puxava o modelo para "não" | `lanes.ts`. Com o executor as chaves levam o nome das manobras (`cross_ahead`, `sidestep_left`...) e a entrada de `cross_ahead` ganha `things_move`. ~730 tokens por decisão (`ordered`), ~1.350 no `graph-maneuver` (duas perguntas). Um leitor roteirizado (`rule-moves`) faz 17,5 ruas |
| E9 (`scene`) | As palavras ampliadas para a linha toda, sob o nome das manobras do `route`: `cross_ahead` (`lands_on`, `things_move` com `left`, `right` ou `still`), `detour_left` e `detour_right` (`opening_ahead`: `adjacent`, `two_away`, `three_or_more` ou `none`; `own_row_that_way`: `blocked_at_once`, `free_for_one`, `free_for_two_or_more`; `recently_failed`), `wait_here.stands_on`, `chicken` (posição no mundo, para onde a plataforma leva, `behind_frontier`) e a memória. Sem dígitos, sem veredito. A palavra `no` de `things_move` virou `still`. Em `cross_ahead.lands_on` a casa é conferida na janela do salto (veículo desde 0,05 s dentro do salto) | `scene.ts`. ~1.750 tokens por pedido de três perguntas |

**E3 em detalhe.** A hipótese era que o modelo erra a água por ter de subtrair `col_da_plataforma − col_da_galinha`; com `dcol`, o teste "a plataforma
da linha da frente me cobre?" vira `|dcol| < half_extent`. É só uma troca de origem: desfazê-la devolve exatamente a observação (teste), então nada é
somado nem perdido e a regra de justiça ([ADR-0005](adr/0005-regra-de-justica-da-observacao.md)) fica intacta. As instruções ganham **uma frase** que descreve essa
coordenada, só para este encoder, de modo que os prompts e o cache das outras condições seguem válidos.

**E2 em detalhe.** Cada quadrado é uma coluna e uma linha. Desenha terreno, árvores nas colunas bloqueadas, a **zona de acerto** de cada
veículo, tora, vitória-régia e trem (o mesmo `half_extent` do JSON), o ponto do semáforo (aceso ou apagado) e a galinha. Como uma
imagem parada não mostra velocidade, cada objeto leva um **rastro claro** atrás de si, do tamanho da distância que ele percorre em
meio segundo, e uma seta de direção. Isso é uma mudança de representação dos mesmos fatos físicos (nenhum julgamento de segurança foi
adicionado, [ADR-0005](adr/0005-regra-de-justica-da-observacao.md)). O PNG é gerado sem dependências (paleta de 19 cores,
blocos deflate sem compressão), roda em Node e no webview, e os testes decodificam o arquivo e conferem pixels específicos.
A API aceita o envio como data URL ([05](05-integracao-clef.md)).

## Estratégias de decisão

| ID | O que faz | Resultado no gate |
|---|---|---|
| `choice` | Uma pergunta `choice` com as 5 ações; usa o `argmax` | Igual a `always-forward` |
| `critic` | Cinco perguntas `noul` ("morre se fizer X?") e a regra "menor risco" (**lógica nossa**) | Estagna: nunca avança |
| `critic-go` | As mesmas perguntas, com a regra "avançar a menos que o risco passe de 50%" (**lógica nossa**) | Igual a `always-forward` (sempre avança) |

| `maneuver` | Uma pergunta `choice` entre cinco manobras (`cross_ahead`, `sidestep_left`, `sidestep_right`, `back_off`, `wait_here`); um **executor** (`executor.ts`) espera a casa ficar pisável e dá o salto, lendo o mundo ao vivo a cada 0,2 s, e só pergunta de novo quando a manobra termina ou não pode ser feita. Com `lanes`+`rules` ou `moves`+`ordered` | 3,40 ruas em 5 partidas (`lanes`+`rules`): o modelo ficou alternando entre `sidestep_left` e `sidestep_right` ([07](07-experimentos.md)) |
| `graph` | **Duas perguntas pequenas na mesma chamada**, com opções mutuamente exclusivas: `go` (avançar: `hop_forward.lands_on` é `empty`, `log` ou `lily_pad`) ou `hold`, e `side` (`hop_left`, `hop_right`, `stay`, `hop_back`). Nossa regra por cima é só o roteamento: `go` é `hop_forward`, `hold` é a resposta da segunda. Só com `moves`+`ordered` | 6,10 ruas em 10 partidas |
| `graph-maneuver` | As mesmas duas perguntas sobre manobras (`go` é `cross_ahead`), com o executor dando o salto. Só com `moves`+`ordered` | **10,05 ruas em 40 partidas** (+6,75 [3,92, 9,93] sobre `always-forward`; +4,80 [2,45, 7,47] sobre o executor sozinho); 58% estagnadas |
| `route` | **Três consultas de um campo cada** na mesma chamada (`cell`: dá para pisar na casa da frente?; `moving`: as coisas dessa linha se movem?; `around`: de que lado contornar?), com exemplos resolvidos, e o **controlador de desvio** (`route.ts`): cruza esperando a brecha, ou caminha a rota por trás, pelo lado e adiante, conferindo cada salto na sua janela. O roteamento é o único código nosso sobre as respostas. Só com `scene`+`lookup` | **O Clef do app** ([07](07-experimentos.md): 22,4 ruas em 7 partidas, 94% de concordância com o escolhedor ideal na sonda) |

As duas estratégias `critic*` põem uma regra nossa sobre as respostas do modelo, então são condições distintas e devem ser
descritas como tal em qualquer relatório. O executor da `maneuver` decide o instante do salto: ele **nunca troca a manobra** que o modelo escolheu, devolve a decisão com o motivo (o modelo o ouve em `memory.last_maneuver`), e traz as referências grátis `exec-cross` (sempre atravessar, sem modelo), `exec-rules` (o escolhedor roteirizado) e `rule-lanes`.

## Instruções e versionamento

- O texto das instruções e dos critérios fica em `packages/agent/src/prompts.ts`, com `PROMPT_VERSION` (hoje `p1`). A versão, o encoder
  e a estratégia entram na chave do cache de decisões e em cada resultado: mudar o prompt invalida o cache.
- O manual descreve as regras físicas do mundo e **nunca** diz qual jogada é boa; um teste proíbe palavras como "should", "safest" e "avoid".
- IDs das ações: `hop_forward`, `hop_back`, `hop_left`, `hop_right`, `stay`; das manobras: `cross_ahead`, `sidestep_left`, `sidestep_right`, `back_off`, `wait_here`.
- Estilo `lookup` (só com `scene` e `route`): o texto do jogo, a legenda do estado e, em cada pergunta, **uma consulta e exemplos resolvidos** (`route-prompts.ts`), no espírito do "dx 79 → false, dx 35 → true" do Mario de [11](11-licoes-dos-jogos-do-jev.md).
- Estilos (`manual`): `full` e `minimal` (congelados por hash, o cache depende deles), `routing` (opções que dizem quando cada jogada serve, sem campos), `rules` (só com `lanes`: as opções citam os campos e as palavras, como o `rule` do Doom em [11](11-licoes-dos-jogos-do-jev.md)), `ordered` (só com `moves`: uma regra curta por jogada, para tentar na ordem dita) e `exclusive` (as mesmas, cada uma excluindo as outras). Combinações sem sentido (`rules` sem `lanes`, `ordered` ou `exclusive` sem `moves`, `graph` e `graph-maneuver` fora de `moves`+`ordered`, `maneuver` fora de `lanes`+`rules` e `moves`+`ordered`, `critic` com as vistas de palavras) são recusadas ao ler o id.
- `bench probe-report` mostra, para as condições de palavras, **quanto o modelo escolhe a jogada que o leitor ideal das regras escolheria** (obediência às regras, não habilidade).

## O que a sonda de 2026-10-14 mostrou

12 cenários feitos à mão, uma chamada cada, uma única redação de prompt. **Amostra pequena: serve para orientar o
trabalho, não para concluir.** Detalhes e números em [00](00-viabilidade.md).

- Clef-flash escolheu `hop_forward` nos 12 cenários, em E0 e em E1.
- O Clef 27B também, exceto por um `stay` no cenário do trem iminente.
- As perguntas `noul` mostram que os modelos distinguem **tipo de terreno** (rua, água e trilho à frente pesam muito mais
  que grama), mas não a **cinemática** (carro se afastando recebe tanto risco quanto carro iminente).
- Árvores (`blocked_cols`) foram ignoradas.

**O gate confirmou a sonda** ([07](07-experimentos.md)): E0, E1, E3, E6, `critic-go`, o manual `minimal` e o Clef 27B ficam indistinguíveis de
"sempre em frente", e E2 (imagem) fica pior. O diagnóstico de AUC mostra que as probabilidades dos modelos separam **tipos de terreno**, mas não
dizem quais saltos para a água sobrevivem. O resultado negativo é o achado do projeto, e o caminho natural é o fine-tuning com este núcleo como ambiente
([ADR-0006](adr/0006-sem-fine-tuning-nem-self-host.md)).

## Auditoria do que o modelo recebe (2026-10-14)

O pedido que o app manda para uma decisão tem três partes (`ModelInput` em `packages/agent/src/policy.ts`), e o app e o benchmark montam exatamente o mesmo (uma função só, `requestFor`, em `clef-policy.ts`):

| Parte | O que é | Exemplo (primeiro rio da seed 4) |
|---|---|---|
| `state` | O conteúdo a avaliar: o mundo, pela vista escolhida | JSON com 12 linhas (`dz` −3 a +8), a memória e, no `json-fx`, a coluna de cada objeto daqui a 0,2 s |
| `questions.move.instructions` | A pergunta e as regras | ~2.000 caracteres no estilo `full` |
| `questions.move.criteria` | As opções e o texto de cada uma | `hop_forward: "Hop one row forward (dz +1), same column."` |

Dá para ver tudo isso **no app** (tecla **I**, ou "What it read" no cartão da decisão) e **na linha de comando** (`pnpm bench show-input --seed 4 --actions hop_forward`, sem rede e sem custo).

**O que a revisão achou.** Os **dados** estão certos: posições, tamanhos, velocidades, árvores, previsão a 0,2 s e memória batem com o simulador (há testes) e o app envia o mesmo que o benchmark (o autoteste responde do cache). O que estava errado é a **forma**:

| # | Achado | Situação |
|---|---|---|
| 1 | A documentação do Clef usa uma pergunta curta e opções que dizem **quando cada uma serve** (`billing: "Payments, invoices, and refunds"`); o app mandava regras longas e opções que só dizem **o que a jogada faz** | Testado: estilo `routing` (abaixo). Mudou o que o modelo escolhe, mas não o acerto |
| 2 | O manual falava em `col` e `blocked_cols`, e as vistas relativas trazem `dcol` e `blocked_dcols`, corrigido só numa nota no fim | Corrigido no estilo `routing`: regras sem nomes de campo e uma nota por vista que os define. `full` e `minimal` ficam como estavam (o cache depende do texto exato; um teste fixa o hash) |
| 3 | Das 12 linhas, as que decidem o salto são as 3 primeiras à frente | Não mudado: um jogador vê a tela toda (ADR-0009) |
| 4 | "Get as far forward as possible" e "the single best action" empurram para "frente" | O estilo `routing` pergunta "Which move does the chicken make now?" |
| 5 | Não dava para ver nada disso | O visualizador e o `show-input` |

O estilo `routing` usa opções iguais para todo estado e sem números (conhecimento geral de jogo, [ADR-0009](adr/0009-percepcao-memoria-e-julgamento.md)): `hop_forward: "The row straight ahead can be entered when the hop ends: no tree in the chicken's column, and on water a log or lily pad under that column, ..."`. Resultado em [07](07-experimentos.md).
