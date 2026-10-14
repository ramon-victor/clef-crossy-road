# 07 · Experimentos e benchmark

> **Status:** gate da Fase 2 avaliado (reprovado com os prompts testados) · **Verificado em:** 2026-10-14 · **Código:** `apps/bench`, `packages/agent`

## Princípios

1. **Mesmo ambiente, mesmas seeds** para todas as políticas, comparação **pareada** por seed.
2. **Baselines antes do modelo.** Sem eles, uma pontuação não significa nada.
3. **Nada é reportado sem uma execução real**; cada resultado leva modelo, versão do prompt, encoder, estratégia, data e uso de tokens.
4. Os modelos hospedados podem mudar sem aviso (o changelog de 2026-10-09 acelerou o Clef sem trocar pesos): sempre registrar a data.
5. **Orçamento: nunca acima do free tier** (10.000 neurons por dia UTC). Ver "Orçamento" abaixo e [ADR-0008](adr/0008-orcamento-diario-no-free-tier.md).

## Como rodar

```bash
pnpm bench plan   --policies <ids> --seeds 1..100          # estima neurons e divide em dias; não chama a API
pnpm bench run    --run <nome> --policies <ids> --seeds 1..100 [--latency fixed:300:pipelined]
pnpm bench report --run <nome>[,<nome>...] --ref always-forward
```

Políticas: `always-forward`, `random`, `lookahead`, `lookahead-comp:<ms>` e `clef:<modelo>:<encoder>:<estratégia>[:<manual>]`
(modelo `clef-flash|clef|clef-omni`; encoder `json|grid|image`; estratégia `choice|critic|critic-go`).
Resultados em `runs/<nome>/episodes.ndjson` (retomável) e `reports/`. As ações de cada partida ficam gravadas: qualquer partida se reproduz exatamente.

## Regras do benchmark

- Cada decisão avança 12 ticks (um salto completo, 0,2 s). A partida termina na morte, em 300 decisões, ou por **estagnação**: 40 decisões seguidas sem alcançar uma linha nova (aplicado a todas as políticas por igual; também limita o custo de uma política que fica indecisa para sempre).
- **Sem atraso** é o modo do gate. Atraso é uma condição à parte (abaixo).
- Os rótulos de política em um relatório incluem o sufixo da condição, por exemplo `@lat300` (serial) ou `@latp300` (pipelined).

## Referências (100 seeds, sem atraso)

| Política | Ruas, média [IC 95%] | Mediana | Observação |
|---|---|---|---|
| `random` | 1,84 [1,61, 2,07] | 2 | Piso absoluto |
| `always-forward` | **3,78** [3,38, 4,22] | 3 | **O piso honesto**; 97% das mortes são afogamento |
| `lookahead` (4 saltos) | **44,75** [37,41, 52,28] | 33,5 | Lê o simulador: é um teto de referência, não um modelo. 78% das partidas terminam por estagnação, não por morte |

## Gate da Fase 2: o Clef-flash supera "sempre em frente"?

> O gate passa se, para alguma condição, o IC de 95% da diferença pareada de ruas contra `always-forward` tiver limite inferior > 0, com ≥ 100 seeds.

| Condição (100 seeds, passo-a-passo) | Ruas | Δ vs `always-forward` [IC 95%] | Veredito |
|---|---|---|---|
| `clef-flash` · JSON · `choice` | 3,70 | −0,08 [−0,24, 0,02] | indistinguível |
| `clef-flash` · grade ASCII · `choice` | 3,67 | −0,11 [−0,53, 0,35] | indistinguível |
| `clef-flash` · JSON · `critic-go` (71 seeds) | 3,35 | 0,00 [0,00, 0,00] | idêntico (sempre avança) |
| `clef-flash` · JSON · `critic` (4 partidas, interrompida) | 0,00 | — | Estagnou 4 de 4: com a regra "menor risco", `hop_left` vence sempre |
| `clef-flash` · JSON · manual **mínimo** · `choice` | 3,71 | −0,07 [−0,22, 0,02] | indistinguível |
| `clef-flash` · **imagem (E2)** · `choice` | 3,36 | **−0,42 [−0,82, −0,05]** | **pior** (83% afogamento, 12% carro) |
| **Clef 27B** · JSON · `choice` (40 seeds) | — | 0,00 [0,00, 0,00] | idêntico: escolheu avançar em todas as decisões |

**Resultado: o gate NÃO passou, em nenhuma das 8 condições testadas** (as quatro primeiras de 2026-10-14 na conta antiga, as três últimas na conta nova). Com estes prompts o Clef-flash se comporta como `always-forward`:
- No `choice`, escolhe `hop_forward` em quase todas as decisões (a taxa de movimentos inválidos de 5% a 16% mostra que às vezes tenta outro caminho e bate numa árvore).
- No `critic`, o modelo dá ao "avançar em grama aberta" risco de 0,30 contra 0,05 para um passo lateral, então uma regra de menor risco nunca avança. Com a regra `critic-go` (avançar a menos que o risco passe de 50%) ele sempre avança, porque o risco de avançar nunca passa de 50%.
- Os modelos separam **tipo de terreno**, não **cinemática** ([06](06-observacao-e-prompts.md)).

Limitações: um único texto de prompt por condição (mais a variante de manual mínimo); 100 seeds (40 no Clef 27B); o `clef-omni` não foi testado.

### Plano B executado (conta nova, 2026-10-14)

A imagem foi aceita como `data:image/png;base64,...` (~972 tokens por decisão, perto dos 900 estimados). O custo real bateu com a
estimativa: ~19 neurons por seed no E2, ~12 no manual mínimo e ~88 no Clef 27B (3.507 neurons para 143 chamadas). Gasto total na conta nova: **6.673 de 10.000**.
Com a imagem as probabilidades ficam quase uniformes (0,26 a 0,39, `confidence` entre 0,02 e 0,07): a partida de teste foi um passeio
aleatório (voltar, voltar, avançar) até se afogar.

### Diagnóstico: o modelo tem algum sinal sobre se avançar é seguro?

`pnpm bench diagnose` reproduz cada decisão gravada no simulador e mede a AUC da probabilidade de `hop_forward` contra "avançar sobrevive"
(0,5 = nenhuma informação). Não faz chamadas à API; lê as ~2.100 decisões já gravadas.

| Condição | Decisões | Avançar é seguro | AUC geral | AUC só na **água** (decisões / fatais) |
|---|---|---|---|---|
| Flash · JSON | 419 | 77% | 0,46 | 0,63 (122 / 96) |
| Flash · JSON, manual mínimo | 416 | 77% | 0,43 | 0,56 (121 / 95) |
| Flash · grade ASCII | 503 | 78% | 0,61 | 0,52 (129 / 105) |
| Flash · imagem | 619 | 82% | 0,49 | 0,52 (138 / 100) |
| **Clef 27B** · JSON | 143 | 68% | **0,75** | 0,51 (54 / 46) |

Leitura:
1. **A água decide o jogo**: de 54 a 138 saltos para a água por condição, **de 72% a 85% são fatais** (acertar uma tora ou um lírio é a única forma de sobreviver).
2. A AUC geral do 27B (0,75) vem de separar **tipos de terreno** (grama é segura, água não). **Dentro da água a AUC é ~0,5**: nenhum modelo diz qual salto cai numa plataforma, que é exatamente a parte que exige aritmética de posição e velocidade.
3. Mesmo assim o 27B avança sempre: a probabilidade de `hop_forward` cai na água, mas continua sendo a maior das cinco opções (argmax).
4. Em estrada e trilho há poucos saltos fatais (0 a 9 por condição), então as AUCs ali são ruído estatístico.

Isso confirma, com dados, a hipótese do [00](00-viabilidade.md): modelos de decisão treinados para triagem leem **categorias**, não **cinemática**.
Uma estratégia que apenas use "P(avançar) abaixo de um limiar" para vetar saltos poderia evitar parte dos saltos para a água, mas muda as trajetórias e não pode ser avaliada com os dados atuais; ficaria como o próximo experimento barato.

## Atraso: a pergunta do modo tempo real

O modelo responde em ~330 ms (mediana medida do Brasil, [05](05-integracao-clef.md)), e o jogo não espera. Com a **latência injetada** (determinística, sem rede) medi o efeito nas referências gratuitas, 100 seeds:

| Política | sem atraso | 300 ms serial | 300 ms pipelined | 800 ms serial | 800 ms pipelined |
|---|---|---|---|---|---|
| `always-forward` | 3,78 | 3,32 | 3,57 | 3,37 | 3,39 |
| `lookahead` (estado velho) | 44,75 | 6,48 | 8,33 | 4,25 | 4,52 |
| `lookahead-comp` (planeja sobre o estado previsto) | — | 11,92 | **20,52** | 7,35 | 8,64 |

- **Serial**: a pergunta sai, o mundo corre pela latência com o herói parado, a ação vale depois. **Pipelined** (como o app em tempo real): a próxima pergunta sai logo após a ação, então o salto acontece durante a espera.
- Dois efeitos distintos: (1) **informação velha**: o plano vem de um estado que já mudou (a compensação recupera parte); (2) **exposição**: o herói fica parado em estrada, trilho ou tora enquanto espera (nenhuma previsão elimina isso; só o pipelining ajuda).
- Mesmo um planejador exato e compensado perde mais da metade da pontuação com 300 ms e quase tudo com 800 ms. **Qualquer expectativa de bom desempenho em tempo real precisa partir disso**, e é por isso que o gate usa passo-a-passo.

## Orçamento

Regra do dono: ficar no free tier, **10.000 neurons por dia UTC** (renova às 21:00 no Brasil).

- Medido: ~1.120 tokens por decisão `choice` (JSON), ~1.320 (grade), ~3.070 (`critic`); Clef-flash a 3.455 neurons por milhão de tokens e Clef 27B a 21.818 (6,3×).
- O `bench` recusa a chamada **antes de enviá-la** quando o ledger (`runs/cache/spend.ndjson`) chega ao limite; o teto só pode ser reduzido (`--daily-neurons`). As execuções da conta nova usaram `--daily-neurons 9000` (10% de folga).
- O ledger é **por conta** (a cota gratuita é por conta): o gasto da conta antiga continua marcado como dela e não bloqueia a nova, nem some.
- O app desktop aplica o mesmo teto no Rust, como constante, com a mesma marcação por conta.
- Um registro honesto: em 2026-10-14 a conta antiga recebeu ~26.300 neurons (2,6× o free tier; ~US$ 0,18 cobrados), porque o orçamento só passou a ser imposto depois. A conta nova ficou em 6.673 de 10.000. Ver [ADR-0008](adr/0008-orcamento-diario-no-free-tier.md).
- O cache de decisões (`runs/cache/clef.ndjson`, ~3.500 respostas) é grátis e sempre permitido: reexecutar seeds já jogadas não gasta nada.
