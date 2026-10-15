# ADR-0009 · Percepção e memória entram na vista do modelo; julgamento não

- **Status:** aceito · **Data:** 2026-10-14 · **Complementa** a [ADR-0005](0005-regra-de-justica-da-observacao.md)

## Contexto

A ADR-0005 impôs que a `Observation` tenha só fatos físicos do instante e nada derivado de uma jogada candidata. A regra protege o
experimento, mas foi lida de forma estreita: **o modelo via menos do que um jogador vê e sabe**. Nove condições (JSON, grade, imagem,
colunas relativas...) só reformataram os mesmos fatos do instante, e o Clef-flash ficou igual a "sempre em frente". O dono pediu que
o limite seja **tudo o que um jogador normal pode ver e saber**: prever o movimento dos objetos, enxergar caminhos alternativos,
perceber que está preso e voltar, com o mundo andando enquanto ele pensa.

## Decisão

Três categorias, e um teste para qualquer campo novo: *"uma pessoa jogando saberia isso só olhando a tela e lembrando?"*

| | Pode entrar | Não pode |
|---|---|---|
| **Percepção** (o que está na tela) | A largura inteira e ~8 linhas à frente e 3 atrás; todo objeto com posição, tamanho e velocidade; o semáforo; **onde cada objeto estará daqui a 0,2 s** (o que o olho vê como movimento); colunas medidas a partir da galinha | — |
| **Memória** (o que o jogador lembra) | As últimas jogadas e o que cada uma fez ("andou", "a árvore bloqueou"), as linhas cruzadas, há quantas jogadas não ganha linha nova | — |
| **Julgamento** (o que o jogador conclui) | — | "Seguro/perigoso", "morre se...", lista de jogadas válidas, tempo-até-colisão, "alcançável", qualquer avaliação por jogada. Quem pensa é o modelo; nenhuma regra nossa decide por ele |

**Conhecimento de jogo** é uma quarta categoria, permitida: as regras e como se joga ("a água afoga sem plataforma", "uma árvore bloqueia", "avançar serve quando a linha à frente pode ser pisada"), **iguais para todo estado e sem números**. Um jogador sabe isso antes de olhar a tela, e é o jeito como a documentação do Clef usa as opções (`criteria` diz quando cada uma serve). Opções escritas assim são uma **condição própria** (`manual: routing`), rotulada no id da política; o que nunca pode entrar é algo calculado a partir do estado diante do modelo.

A previsão a 0,2 s é uma função pura da observação (`col + velocidade × 0,2 s`). Ela é **igual para qualquer jogada e para qualquer posição da
galinha**, e um teste confere que bate com o simulador 12 ticks depois (`packages/agent/src/forecast.test.ts`).

A memória não entra na `Observation` (o schema continua o da ADR-0005): o runner e a `Session` do app a montam e passam como segundo
argumento de `decide(obs, memory)`. Os encoders antigos a ignoram, então suas requisições e o cache não mudam.

## Como o benchmark continua honesto

- Cada encoder declara um **nível de percepção** (`now`, `memory`, `forecast`) e `bench report` o mostra ao lado de cada política.
- O encoder `json` (nível `now`, sem memória) segue como **controle** em toda comparação, junto de `always-forward` e `lookahead`.
- Os jogadores roteirizados `rule-view` e `rule-view-fx` leem só o que as vistas mostram e servem de **teste de suficiência gratuito**:
  se um leitor simples joga bem com aquela vista, a vista tem informação bastante. São referências, nunca modelos.
- O `bench probe` rotula estados com o simulador para corrigir as respostas; os rótulos **nunca** vão para o modelo (um teste confere).
- Qualquer regra nossa sobre as respostas (`critic`, "não repetir a jogada bloqueada") continua sendo outra condição, descrita como tal.

## Consequências

- (+) O modelo passa a receber o que um jogador usa, e o resultado mede o que o Clef faz com isso.
- (+) Cada condição tem rótulo, então ninguém compara `json` com `json-fx` sem saber o que muda.
- (−) A fronteira "percepção ou julgamento" é uma decisão humana; os campos novos passam pelo teste acima e por um teste de palavras proibidas.
- Resultado medido: [07](../07-experimentos.md) ("Vista de jogador" e "Opções que dizem quando cada jogada serve"). Nenhuma das vistas, nem o estilo `routing`, fez o Clef jogar melhor que "sempre em frente".
- O que o modelo recebe pode ser visto no app (tecla I) e com `pnpm bench show-input`, que imprimem o pedido exatamente como é enviado.
