# ADR-0005 · Regra de justiça da observação

- **Status:** aceito · **Data:** 2026-10-14

## Contexto

Se a observação trouxer "movimentos seguros" ou "tempo até a colisão", medimos a nossa lógica, não o modelo.

## Decisão

A `Observation` contém apenas **fatos físicos medidos** (terreno, posições, larguras, velocidades em tiles/s, fase do
semáforo, o que há sob o jogador). Nunca contém nada que seja função de uma ação candidata: rótulos de segurança, lista de
movimentos válidos, tempo-até-colisão com o jogador. Movimento inválido vira no-op e entra como métrica.
Um teste congela o conjunto de chaves permitidas.

Mudar a representação (JSON, grade, imagem) é permitido, mas é uma condição própria no relatório.
A estratégia S2 (`ClefCritic`) usa uma regra de seleção nossa sobre as respostas do modelo; ela é uma condição distinta
e deve ser descrita no relatório.

## Atualização (2026-10-14)

O encoder `json-rel` (colunas medidas a partir da galinha, `dcol`) é uma **mudança de representação**, permitida acima: ele só troca a origem das colunas, desfazê-la devolve a
observação (há um teste), e nenhum campo depende de uma ação candidata. Resultado: [07](../07-experimentos.md). (Ao contrário do que esta página dizia antes, uma posição **prevista** passou a ser permitida: ver a revisão abaixo.)

## Revisão (2026-10-14)

A [ADR-0009](0009-percepcao-memoria-e-julgamento.md) separa **percepção**, **memória** e **julgamento** e passa a valer para tudo o que o modelo lê além da
`Observation`. A previsão de onde cada objeto estará daqui a 0,2 s e as últimas jogadas são percepção e memória: entram. O que esta ADR proíbe, o
julgamento ("seguro", "alcançável", tempo-até-colisão, lista de jogadas válidas), continua proibido, e a `Observation` continua com as chaves congeladas por teste.

## Consequências

- (+) O resultado mede a capacidade do modelo.
- (−) Observações brutas dão ao modelo mais trabalho; a sonda de 2026-10-14 sugere que isso pesa.
- Revisar este ADR antes de qualquer mudança no schema da observação.
