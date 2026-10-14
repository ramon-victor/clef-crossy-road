# 06 · Observação e prompts

> **Status:** rascunho; guiado pela sonda de 2026-10-14 · **Verificado em:** 2026-10-14 · **ADR:** [0005](adr/0005-regra-de-justica-da-observacao.md)

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

Mudar a **representação** (JSON → grade → imagem) é permitido, mas aparece no relatório como condição própria.

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

As duas estratégias `critic*` põem uma regra nossa sobre as respostas do modelo, então são condições distintas e devem ser
descritas como tal em qualquer relatório.

## Instruções e versionamento

- O texto das instruções e dos critérios fica em `packages/agent/src/prompts.ts`, com `PROMPT_VERSION` (hoje `p1`). A versão, o encoder
  e a estratégia entram na chave do cache de decisões e em cada resultado: mudar o prompt invalida o cache.
- O manual descreve as regras físicas do mundo e **nunca** diz qual jogada é boa; um teste proíbe palavras como "should", "safest" e "avoid".
- IDs das ações: `hop_forward`, `hop_back`, `hop_left`, `hop_right`, `stay`.

## O que a sonda de 2026-10-14 mostrou

12 cenários feitos à mão, uma chamada cada, uma única redação de prompt. **Amostra pequena: serve para orientar o
trabalho, não para concluir.** Detalhes e números em [00](00-viabilidade.md).

- Clef-flash escolheu `hop_forward` nos 12 cenários, em E0 e em E1.
- O Clef 27B também, exceto por um `stay` no cenário do trem iminente.
- As perguntas `noul` mostram que os modelos distinguem **tipo de terreno** (rua, água e trilho à frente pesam muito mais
  que grama), mas não a **cinemática** (carro se afastando recebe tanto risco quanto carro iminente).
- Árvores (`blocked_cols`) foram ignoradas.

**O gate confirmou a sonda** ([07](07-experimentos.md)): E0, E1, `critic-go`, o manual `minimal` e o Clef 27B ficam indistinguíveis de
"sempre em frente", e E2 (imagem) fica pior. O diagnóstico de AUC mostra que as probabilidades dos modelos separam **tipos de terreno**, mas não
dizem quais saltos para a água sobrevivem. O resultado negativo é o achado do projeto, e o caminho natural é o fine-tuning com este núcleo como ambiente
([ADR-0006](adr/0006-sem-fine-tuning-nem-self-host.md)).
