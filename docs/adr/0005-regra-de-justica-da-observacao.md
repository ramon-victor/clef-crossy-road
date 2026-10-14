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

## Consequências

- (+) O resultado mede a capacidade do modelo.
- (−) Observações brutas dão ao modelo mais trabalho; a sonda de 2026-10-14 sugere que isso pesa.
- Revisar este ADR antes de qualquer mudança no schema da observação.
