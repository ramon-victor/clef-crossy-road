# 07 · Experimentos e benchmark

> **Status:** gate da Fase 2 avaliado (reprovado com os prompts testados; uma condição nova, com palavras e executor, passa com 40 seeds e espera as 100) · **Verificado em:** 2026-10-17 · **Código:** `apps/bench`, `packages/agent`

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
(modelo `clef-flash|clef|clef-omni`; encoder `json|json-rel|grid|image|view|view-fx|json-fx`; estratégia `choice|critic|critic-go|maneuver`; estilo `full|minimal|routing|rules`; as duas últimas opções só com o encoder `lanes`). O id curto `clef` é o Clef padrão do app
(`clef:clef-flash:json-fx:choice:full`); os relatórios gravam sempre o id por extenso e mostram o **nível de percepção** (`now`, `memory`, `forecast`) de cada condição.
`rule-view`, `rule-view-fx`, `rule-lanes`, `exec-cross` e `exec-rules` são jogadores roteirizados de referência (nunca modelos). `pnpm bench probe-sample`, `probe-run` e `probe-report` medem escolhas em estados rotulados.
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
| `clef-flash` · **JSON relativo (`json-rel`)** · `choice` (40 seeds) | 3,20 (referência nas mesmas 40 seeds: 3,30) | −0,10 [−0,30, 0,00] | indistinguível |
| `clef-flash` · **vista de jogador (`json-fx`)** · `choice` | 3,73 | −0,05 [−0,21, 0,08] | indistinguível |
| **Clef 27B** · vista de jogador (`json-fx`) (8 seeds) | 2,63 | 0,00 [0,00, 0,00] | idêntico (preliminar: só 8 partidas) |
| `clef-flash` · `view-fx` · estilo **`routing`** (7 partidas, de 10; parou no teto de chamadas) | 1,43 | **−1,29 [−2,57, −0,29]** | **pior**: 43% estagnaram, 57% afogaram |

**Resultado: o gate NÃO passou, em nenhuma das 12 condições testadas** (as quatro primeiras de 2026-10-14 na conta antiga, as demais nas contas novas; as duas últimas, só em 8 e 7 partidas, por custo). Com estes prompts o Clef-flash se comporta como `always-forward`:
- No `choice`, escolhe `hop_forward` em quase todas as decisões (a taxa de movimentos inválidos de 5% a 16% mostra que às vezes tenta outro caminho e bate numa árvore).
- No `critic`, o modelo dá ao "avançar em grama aberta" risco de 0,30 contra 0,05 para um passo lateral, então uma regra de menor risco nunca avança. Com a regra `critic-go` (avançar a menos que o risco passe de 50%) ele sempre avança, porque o risco de avançar nunca passa de 50%.
- Os modelos separam **tipo de terreno**, não **cinemática** ([06](06-observacao-e-prompts.md)).

Limitações: um único texto de prompt por condição (mais a variante de manual mínimo); 100 seeds (40 no Clef 27B); o `clef-omni` não foi testado.

**Atualização de 2026-10-15:** uma 13ª condição, já com palavras no lugar de números, opções que citam os campos, duas perguntas pequenas e um executor (`moves`, `graph-maneuver`, ver o fim desta seção), faz **10,05 ruas em 40 seeds**, com o intervalo da diferença pareada contra `always-forward` todo acima de zero. O portão formal (≥ 100 seeds) segue pendente.

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
| Flash · JSON relativo (40 seeds) | 169 | 77% | 0,35 | 0,54 (44 / 39) |
| **Clef 27B** · JSON | 143 | 68% | **0,75** | 0,51 (54 / 46) |

Leitura:
1. **A água decide o jogo**: de 54 a 138 saltos para a água por condição, **de 72% a 85% são fatais** (acertar uma tora ou um lírio é a única forma de sobreviver).
2. A AUC geral do 27B (0,75) vem de separar **tipos de terreno** (grama é segura, água não). **Dentro da água a AUC é ~0,5**: nenhum modelo diz qual salto cai numa plataforma, que é exatamente a parte que exige aritmética de posição e velocidade.
3. Mesmo assim o 27B avança sempre: a probabilidade de `hop_forward` cai na água, mas continua sendo a maior das cinco opções (argmax).
4. Em estrada e trilho há poucos saltos fatais (0 a 9 por condição), então as AUCs ali são ruído estatístico.

Isso confirma, com dados, a hipótese do [00](00-viabilidade.md): modelos de decisão treinados para triagem leem **categorias**, não **cinemática**.
Uma estratégia que apenas use "P(avançar) abaixo de um limiar" para vetar saltos poderia evitar parte dos saltos para a água, mas muda as trajetórias e não pode ser avaliada com os dados atuais; ficaria como o próximo experimento barato.

### Uma melhoria justa: colunas relativas à galinha (`json-rel`, 2026-10-14)

Pedido do dono depois de ver o app: o Clef "anda reto e se joga na água". Antes de mexer em qualquer coisa, o app foi reduzido a **um** Clef (as outras
condições são eixos do benchmark, não jogadores) e testou-se **uma** melhoria que respeita a regra de justiça: escrever as colunas como `dcol`, o deslocamento até a
galinha ([06](06-observacao-e-prompts.md), E3). Só uma mudança de origem; nenhuma informação derivada das ações.

Protocolo combinado antes de rodar: `bench plan` (coube: 1.625 neurons no pior caso para 100 seeds, com 2.284 disponíveis sob o teto de 9.000); 40 seeds primeiro, com
`--max-calls 250`; **parar** se a média ficasse em torno de "sempre em frente" **e** a AUC dentro da água em torno de 0,5; seguir até 100 seeds só se houvesse sinal.

| Medida (40 seeds, mesmo mapa de `always-forward`) | Resultado |
|---|---|
| Ruas, média [IC 95%] | `json-rel` **3,20** [2,77, 3,70] contra `always-forward` **3,30** [2,85, 3,80] |
| Diferença pareada | −0,10 [−0,30, 0,00]: **indistinguível** |
| Mortes | 98% afogamento, 3% estagnação; 0% carro |
| Movimentos inválidos | 23% das decisões (tenta avançar contra árvore; o `json` ficava entre 5% e 16%) |
| Saltos para a água | 44, dos quais **39 fatais (89%)**; AUC de P(avançar) dentro da água **0,54** |
| Custo | 131 chamadas, 157.869 tokens (**1.163 por decisão**), **545 neurons**; latência p50 783 ms, p95 2.201 ms (sob 4 chamadas paralelas) |

As duas condições de parada foram atendidas, então **a execução parou em 40 seeds** (poupou os ~1.000 neurons estimados para o resto). O Clef padrão do app continua sendo o
`json`. Leitura: dar a subtração pronta não ensina o modelo a olhar **onde a tora estará** quando o salto pousar (0,2 s depois), que é o que decide a água; ele continua
tratando "água à frente" como um tipo de terreno. Gasto da conta `df5a…` no dia 2026-10-14 (UTC): **7.261 de 10.000** (6.716 antes desta execução).

### Vista de jogador: tela inteira, movimento previsto e memória (2026-10-14)

Pedido do dono depois de ver o app: o Clef "buga fácil, trava em pedra, cai na água". O critério passou a ser **tudo o que um jogador normal vê e sabe**
([ADR-0009](adr/0009-percepcao-memoria-e-julgamento.md)). As vistas novas ([06](06-observacao-e-prompts.md), E4 a E6) dão ao modelo a tela inteira como mapa,
**onde cada objeto estará daqui a 0,2 s** e **a memória das últimas jogadas**. Tudo medido pelo cliente com orçamento, em ordem:

**1. Suficiência, grátis (100 seeds).** `rule-view` e `rule-view-fx` são jogadores roteirizados que leem só o que cada vista mostra; dizem se a vista tem informação bastante.

| Política | Vê | Ruas [IC 95%] | Δ vs `always-forward` [IC 95%] |
|---|---|---|---|
| `always-forward` | nada | 3,78 [3,39, 4,24] | — |
| `rule-view` | mapa agora (roteirizado) | 13,53 [11,39, 15,78] | +9,75 [7,57, 12,02] |
| `rule-view-fx` | mapa + 0,2 s (roteirizado) | 18,63 [15,43, 22,04] | +14,85 [11,65, 18,20] |
| `lookahead` | o simulador | 44,75 [37,50, 52,27] | +40,97 [33,75, 48,44] |

Um leitor simples faz de 3,6× a 4,9× o piso com essas vistas, então a informação está lá. O movimento previsto vale ~5 ruas para o leitor roteirizado.

**2. Sondas** (`pnpm bench probe-*`, 90 estados rotulados pelo simulador, uma pergunta por estado e condição; o rótulo nunca vai ao modelo). "Fatal" é escolher uma jogada que morre; "boa" é escolher uma que o look-ahead
dá como a melhor, com margem de uma linha; AUC é a de P(avançar) entre estados abertos e mortais (0,5 = nenhuma informação).

| Condição | Água mortal: escolha fatal (n=24) | Boa jogada na água (n=36) | AUC água | Rua mortal: fatal (n=12) | Árvore, 2ª tentativa: repete a jogada (n=10) | Boa jogada, todos |
|---|---|---|---|---|---|---|
| Flash · `json` (controle, nível `now`) | 96% | 36% | 0,61 | 100% | 100% | 38% |
| Flash · `view` (memória) | 88% | 36% | 0,40 | 75% | 90% | 43% |
| Flash · `view-fx` (+ movimento) | 88% | 33% | 0,41 | 67% | 100% | 39% |
| Flash · `json-fx` (+ movimento, JSON) | 96% | 36% | 0,66 | 100% | **50%** | **44%** (Δ +7 [1, 13]) |
| **Clef 27B** · `json-fx` | **71%** | 47% (Δ +11 [−3, 28]) | **0,74** | 92% | **30%** | **51%** (Δ +13 [4, 22]) |
| Clef-omni · imagem (46 estados) | 100% (n=6) | 50% (n=12) | 0,39 | 100% (n=6) | 100% (n=6) | 48% |

- **Água:** nenhuma vista fez o Clef-flash escolher menos saltos fatais de forma mensurável (Δ da boa jogada na água: 0 [−8, 8] com `json-fx`). O modelo põe a maior probabilidade em avançar mesmo com a água e a plataforma escritas na frente dele.
- **Pedra:** a memória em campos de JSON (`json-fx`) tirou o modelo do laço em metade dos casos (Δ +50 pontos [20, 80]); a memória em texto (`view`) quase não mudou nada (90%).
- **Rua:** a vista ajuda um pouco (AUC de 0,63 para 0,85), mas as escolhas fatais seguem altas.
- **Tamanho:** o 27B com `json-fx` é o único que se mexe na água (71% fatal contra 96%, AUC 0,74), com a melhor taxa de boa jogada. A imagem no Clef-omni não muda nada.

**3. Partidas completas.** Para conferir as sondas (pela regra combinada antes de gastar, nenhuma condição passou: a melhoria na água ficou abaixo de 25 pontos):

| Condição | Seeds | Ruas | Δ vs `always-forward` [IC 95%] | Mortes |
|---|---|---|---|---|
| Flash · `json-fx` | 100 | **3,73** [3,39, 4,11] | −0,05 [−0,21, 0,08] **indistinguível** | 96% afogamento, 4% carro |
| Clef 27B · `json-fx` | 8 (só 8, por custo) | 2,63 | 0,00 [0,00, 0,00] | 100% afogamento no primeiro rio |

No 27B, o motivo é visível nos registros: no primeiro rio, com lírios a uma coluna de distância, a probabilidade de avançar foi de **0,68 a 0,80** nas oito partidas. Ele sabe pouco mais que o Flash sobre
estados mortais difíceis, mas no rio mais simples ainda confia no "avançar". O que cada vista **não** conseguiu foi fazer o modelo usar a plataforma que está escrita ali.

**Custo.** Tokens por decisão: `json-fx` 1.425 (100 partidas), `view` 1.367, `view-fx` 1.540 (nos 90 estados), 27B `json-fx` ~1.410; Clef-omni com imagem 970. Neurons usados nestes testes: **1.271 na conta `df5a…`** (que o app do
dono também usou no mesmo dia: 8.739 de 10.000) e **6.763 na conta `f173…`** (sondas do Flash `json-fx` 485, do 27B e do Clef-omni 3.669, partidas do Flash `json-fx` 1.963, do 27B 646). Nenhuma conta passou de 10.000.
O 27B custa ~30 neurons por decisão (o free tier de uma conta dá ~300 decisões por dia), então 100 partidas dele não cabem em menos de vários dias.

**Decisão sobre o app.** O Clef do app passou a ser o `json-fx` (a vista de jogador): no placar ele é igual ao `json` (3,73 contra 3,70), as decisões das seeds 1 a 100 estão no cache para essa vista (replays seguem grátis) e a memória
ajuda onde o modelo mais trava. É uma escolha sobre o que o modelo vê, não sobre pontuação.

### Opções que dizem quando cada jogada serve (`routing`, 2026-10-15)

Depois do visualizador, a revisão do que o modelo recebe ([06](06-observacao-e-prompts.md)) apontou que a documentação do Clef usa **uma pergunta curta e opções que dizem quando cada uma serve**, e o app fazia o contrário. O estilo `routing`
(`manual: "routing"`) escreve as regras sem nomes de campo e as opções como condições gerais (iguais para todo estado, sem números). Sonda de 90 estados, Clef-flash:

| Condição (Flash) | Água mortal: escolha fatal (n=24) | Água aberta: boa jogada (n=12) | Rua mortal: fatal (n=12) | Grama aberta: boa jogada (n=8) | Árvore, 2ª tentativa: repete | Boa jogada, todos | Jogadas escolhidas (90) |
|---|---|---|---|---|---|---|---|
| `json-fx` · `full` (o app até aqui) | 96% | 100% | 100% | 100% | 50% | 44% | 82 frente, 5 esq., 2 dir., 1 trás |
| `json-fx` · **`routing`** | **33%** | 42% | 33% | 63% | 30% | 52% (Δ +14 [1, 28] contra o controle `json`) | **16 frente, 56 esq., 12 esperar, 6 dir.** |
| `view-fx` · **`routing`** | **13%** | 33% | 25% | 50% | 20% | 59% (Δ +21 [7, 36]) | **13 frente, 44 esperar, 31 esq., 2 dir.** |

AUC de P(avançar) entre estados abertos e mortais: `json-fx` `routing` 0,56 na água e 0,61 na rua; `view-fx` `routing` 0,63 e 0,57 (o `full` tinha 0,66 e 0,85).

**Partidas completas** (`view-fx` + `routing`, 10 seeds pedidas, 7 terminadas antes do teto de 150 chamadas): **1,43 ruas** contra 2,80 do `always-forward` nas mesmas seeds (Δ −1,29 [−2,57, −0,29], **pior**), 57% afogamento, **43% estagnação**, 24% das jogadas batendo em árvore.
Nas 220 decisões escolheu `stay` 143 vezes, `hop_left` 67 e `hop_forward` 10; nunca `hop_right` nem `hop_back`. Na seed 6, 28 de 40 jogadas foram esquerda contra a mesma árvore.

**Leitura.** O texto das opções **muda tudo o que o modelo escolhe** (de "82 de 90 para frente" para "16 de 90") e quase nada do **quanto ele olha para o estado**: a AUC fica em 0,56 a 0,63 em qualquer redação. Com as opções antigas o modelo ia reto;
com as novas ele se **protege** (a escolha fatal na água mortal cai de 96% para 13–33%), mas também deixa de avançar quando dá (água aberta: 33–42% de boa jogada), espera, anda de lado e bate em árvore. A decisão é puxada pelo **significado das palavras das opções**, não pela coluna da plataforma. Isso explica por que nenhuma vista ajudou.
A regra de parada da sonda (melhoria na água de ≥ 25 pontos com IC sem zero) também não foi atendida (Δ +11 e +19, ICs com zero), e a partida completa confirmou. Custo: 944 neurons na sonda e 1.062 nas partidas, **2.006 na conta `f173…`** (a `df5a…` não gastou nada no dia 2026-10-15 UTC).

### Palavras, regras e executor, a partir dos 13 jogos do Jev (2026-10-15)

Depois de ler os 13 repositórios ([11](11-licoes-dos-jogos-do-jev.md), [ADR-0010](adr/0010-palavras-regras-e-executor-de-manobras.md)) a vista e as opções foram reescritas: o código compara e entrega **palavras** (`lanes`, depois `moves`), as opções viram **regras curtas sobre essas palavras**, a decisão vira **duas perguntas pequenas** (`graph`) e um **executor** dá o salto (`maneuver`, `graph-maneuver`). Tudo rotulado em "Sees" nos relatórios.

**1. De graça: a informação basta?** Cem seeds, sem rede, mesmos mapas (`bench run --run refs-final`):

| Política | O que lê | Ruas [IC 95%] | Δ vs `always-forward` [IC 95%] | Mortes (água / carro / borda) | Estagnou |
|---|---|---|---|---|---|
| `always-forward` | nada | 3,78 [3,39, 4,24] | — | 97% / 3% / 0% | 0% |
| `exec-cross` | palavras, sempre "atravessar", com o executor (**o executor sozinho**) | 6,08 [4,95, 7,31] | +2,30 [1,17, 3,53] | 0% / 40% / 8% | 46% |
| `rule-moves` | as palavras de `moves`, regras na ordem (roteirizado, um salto por decisão) | 17,45 [14,52, 20,52] | +13,67 [10,72, 16,74] | 5% / 27% / 16% | 52% |
| `exec-rules` | palavras + escolha roteirizada das manobras + executor | 18,83 [15,60, 22,26] | +15,05 [11,81, 18,49] | 0% / 32% / 19% | 47% |
| `rule-lanes` | as palavras de `lanes` (roteirizado) | 19,71 [16,33, 23,28] | +15,93 [12,55, 19,43] | 9% / 18% / 17% | 56% |

As **palavras bastam**: um leitor que só vê o vocabulário joga tão bem quanto o `rule-view-fx` de antes (18,6). A concordância da palavra de cada casa com o simulador foi de mais de 97% em água, grama e estrada (no trilho a palavra é conservadora de propósito: `train_coming` com a luz acesa). O executor sozinho já vale +2,3 ruas; é o piso do Clef com executor.

**2. Sondas** (Clef-flash, 90 estados rotulados, ~230 a 540 neurons cada; "escolha fatal na água mortal" é a fração dos 24 estados em que a jogada escolhida afoga; "boa" é a jogada que o look-ahead dá como a melhor, com margem de uma linha):

| Condição (o que muda) | Água mortal: fatal | Boa na água (36) | AUC água / rua | Concorda com o leitor ideal |
|---|---|---|---|---|
| `json` · `full` (controle) | 96% | 36% | 0,61 / 0,63 | — |
| `json-fx` · `full` (o Clef do app até então) | 96% | 36% | 0,66 / 0,85 | — |
| `lanes` · `full` (palavras, texto antigo das opções) | 42% | 53% | 0,73 / 0,67 | 37% |
| `lanes` · `rules` (palavras + opções que citam os campos) | **8%** | 67% | 0,89 / 0,91 | 52% |
| `moves` · `ordered` · primeira redação (nome da linha no estado) | 8% | 56% | **1,00** / 0,96 | 48% |
| `moves` · `exclusive` (cada opção exclui as outras) | 8% (50% na água aberta) | 47% | 0,92 / 0,92 | 40% |
| `moves` · `graph` · primeira redação | 0% | 61% | 0,99 / 0,98 | 58% |
| `moves` · `ordered` (sem o nome da linha) | **0%** | **78%** | 1,00 / 0,95 | 57% |
| `moves` · `graph` (sem o nome da linha) | **0%** | 72% | 1,00 / 0,98 | 60% |
| Clef 27B · `moves` · `ordered` | 0% | 86% | 1,00 / 0,85 | 66% (1.407 neurons) |

- **O que mais ajudou:** (1) dar palavras em vez de números (96% → 42%); (2) opções que nomeiam os campos e as palavras (→ 8%); (3) alinhar o estado às opções (uma entrada por jogada, com o nome dela); (4) **tirar do estado a palavra `water` do campo `row`**: ao lado de `lands_on: log` ela puxava o modelo para "não" em 11 de 12 estados com plataforma embaixo; sem ela a água mortal ficou sem nenhuma escolha fatal.
- **O que não ajudou:** escrever "só se as anteriores forem falsas" (o modelo escolhe a última opção verdadeira: `hop_left` quando tudo está livre, `hop_back` no lugar de `stay`), tornar as opções mutuamente exclusivas por texto (`exclusive`, pior na água aberta) e regra de limiar sobre as probabilidades (calculada de graça sobre as respostas gravadas: não passou do argmax).
- O **27B** quase não melhora sobre o Flash nessa vista (+3 pontos [−8, 14] de boas jogadas no total) e custa 6,3×; as partidas seguintes são do Flash.
- A concordância com o leitor ideal ficou em 40 a 66%: o modelo **não obedece às regras como um programa**. O que ele faz bem é separar estados abertos de mortais pela probabilidade (AUC ≈ 1).

**3. Partidas** (Clef-flash, mesmos mapas do benchmark; ledger do dia lido ao final):

| Condição | Seeds | Ruas [IC 95%] | Mortes (água / carro / borda) · estagnou | Neurons |
|---|---|---|---|---|
| `lanes` · `rules`, uma decisão por salto | 5 | 3,80 [2,00, 6,60] | 100% água | 185 |
| `lanes` · `maneuver` · `rules` (executor) | 5 | 3,40 [1,40, 5,40] | 0% / 0% / 40% · 60% | 319 |
| `moves` · `ordered` (sem o nome da linha), um salto por decisão | 10 | 4,00 [2,60, 5,70] | 50% / 40% / 10% · 0% | 575 |
| `moves` · `graph`, um salto por decisão | 10 | 6,10 [3,70, 8,60] | 20% / 50% / 0% · 30% | 1.033 |
| **`moves` · `graph-maneuver` · `ordered`** (o Clef novo do app) | **40** | **10,05 [7,20, 13,32]** | **0% / 25% (+3% trem) / 15% · 58%** | 4.758 |

Sobre as mesmas 40 seeds, o Clef novo faz **+6,75 ruas [3,92, 9,93] sobre `always-forward`** e **+4,80 [2,45, 7,47] sobre o executor sozinho**; não afoga nunca. É a primeira condição do projeto com o intervalo todo acima de zero. As partidas são muito desiguais (mediana 7; uma chegou a 45 ruas, 58% terminam estagnadas). Os leitores roteirizados da mesma vista fazem 17 a 20: o modelo chega a pouco mais da metade do teto das suas próprias regras.

- Os 40 mapas (seeds 1 a 40) ficam no cache para esta condição, então **o app os repete de graça**.
- O que ainda mata: carro (o modelo escolhe sair de lado ou esperar em plena estrada, ou `back_off` com a casa de trás na água) e o laço "escolher de novo a manobra recusada" (`sidestep_right` com árvore à direita 40 vezes seguidas: o modelo ouve em `memory.last_maneuver` que foi recusada e repete).
- Duas correções feitas no meio, vistas nos próprios registros: o que há embaixo da galinha parada passou a olhar 0,4 s à frente (um carro que chega logo depois ainda a acerta antes de ela se mexer), e a regra de manobra passou a mandar sair de onde ela não aguenta antes de "esperar uma brecha". As 10 primeiras partidas (6,40 ruas) foram feitas antes dessas correções e refeitas depois (8,60 nas mesmas 10; a amostra de 40 usa o texto final).

**Limites.** 40 seeds, não 100: o portão da Fase 2 (limite inferior do IC pareado > 0 com ≥ 100 seeds) segue **pendente**; o limite inferior já é positivo com 40 e 25 seeds, mas o portão exige 100, e faltam ~7.000 neurons, mais do que restava no dia. As condições anteriores a `moves` sem o nome da linha foram medidas com redações intermediárias (descritas acima, não reproduzíveis pelo código atual). Gasto de 2026-10-15 (UTC): conta `df5a…` 5.964 (o app incluído) e conta `f173…` 8.171, nenhuma acima de 10.000.

Nada disto muda o que vale para o Clef do app antes: o `json-fx` segue igual a `always-forward`. O jogador novo é uma **condição rotulada** ("palavras, regras no texto e controlador"), não uma prova de que o modelo joga: as regras e o instante do salto são nossos.

### Menos estagnação e mais acerto: vista de cena, três consultas e controlador com rota (2026-10-15)

Pedido do dono depois de testar a condição acima: "melhorou, mas ainda estagna muito". O diagnóstico veio dos 40 jogos gravados e do simulador, sem rede ([ADR-0011](adr/0011-controlador-com-rota-e-tres-consultas.md)).

**1. Por que estagnava** (23 das 40 partidas, 58%):
- o final de quase toda partida estagnada é **uma só manobra repetida 30 a 40 vezes** (`wait_here` ×37 a ×40 em 13 jogos; `sidestep_*` recusado e escolhido de novo);
- em **26%** das 1.828 decisões do modelo o escolhedor ideal mandava `cross_ahead` e ele escolhia `wait_here`: P(avançar) **42%** com `lily_pad`, **45%** com `log`, **28%** com `train_coming`, contra 76–84% com `empty` (a pergunta tinha uma regra de dois campos);
- no ponto onde o progresso parou, o simulador achava saída com 0 ou 1 passo de lado em 10 jogos (o modelo errou), com 2 ou mais passos de lado em 6 e **só voltando uma linha, deslizando e avançando duas vezes** em 7 (cercadas por árvores).

**2. Tetos grátis** (100 seeds, sem rede, leitores roteirizados; os três primeiros são protótipos de análise, não código do repositório):

| Leitor das palavras | Ruas | Estagnou |
|---|---|---|
| `exec-rules` (a condição anterior, escolhedor ideal) | 18,8 | 47% |
| + a linha da frente inteira (alcance de 5 colunas) | 19,7 | 39% |
| + rota até "a linha à frente de onde estou" (oscilava) | 19,8 | 38% |
| + rota até a **linha de fronteira**, profundidade 6 / 8 / 10 | 24,3 / 26,1 / 28,7 | 26% / 16% / 11% |
| **`exec-route`** (o código final: rota com deriva, janela do salto e retenção segura) | **48,3** (mediana 38) | 59% (em ruas altas: becos sem saída) |
| `lookahead` (o simulador) | 44,75 | |

O alcance lateral sozinho quase não ajuda; o que destrava é a rota que **volta uma linha** e mirar a **linha de fronteira** (a mais longe já alcançada). As mortes do `exec-route`: afogamento 0%, carro 17%, borda 7%, trem 2%; 15% chegam ao teto de 300 decisões. Três correções, vistas nos próprios registros: o veículo conta **desde 0,05 s dentro do salto** que traz a galinha à linha (a janela antiga olhava a partir de 0,1 s: 23,8 → 31,9 ruas); a galinha parada numa tora é **carregada** (a busca modela a deriva e o controlador sai da tora antes da borda: 31,9 → 41,7); e uma manobra recusada deixa a galinha em **retenção segura** em vez de parada onde um veículo vai chegar (41,7 → 48,3).

**3. Sondas** (Clef-flash, 90 estados rotulados, 507 a 542 neurons cada): a concordância com o escolhedor ideal das regras, em estados com a palavra à frente em cada classe.

| Condição | Concorda com o ideal | Erro que sobrou |
|---|---|---|
| condições de palavras anteriores (`lanes`, `moves`, `graph`) | 40% a 66% | `go` ≈ 40% com `lily_pad`/`log` |
| `scene`+`route`, duas perguntas (`ahead`: aberta, passando, fechada) | 86% | água parada lida como "passando" (4 de 12 certas) |
| idem, `no` trocado por `still` e exemplos novos | 85% | água parada: **0 de 12** (a regra de dois campos) |
| **três consultas de um campo** (`cell`, `moving`, `around`) | **94%** | 5 de 90 (o lado quando as aberturas são tão próximas quanto) |

Por classe do que há à frente (3 consultas): árvore 20/20, água parada 12/12, água com coisas passando 10/12, casa vazia 17/17, veículo 13/13, tora 10/10, lírio 2/2, trem a caminho 4/4. As duas mudanças que fizeram a diferença: tirar do modelo a regra composta (cada pergunta lê **um** campo) e dar **exemplos resolvidos**.

**4. Partidas** (Clef-flash, `clef:clef-flash:scene:route:lookup`; uma partida tem de 5 a 67 chamadas ao modelo; ~6,1 neurons por pedido de três perguntas, 1.774 tokens):

| Seed | Ruas | Fim | Chamadas ao modelo | Controlador |
|---|---|---|---|---|
| 2 | 51 | estagnou | 67 | anterior (sem `canSettle`) |
| 3 | 4 | trem | 5 | anterior |
| 4 | 35 | carro | 49 | anterior |
| 5 | 11 | carro | 22 | anterior |
| 6 | 9 | borda | 20 | final |
| 7 | 8 | carro | 19 | final |
| 8 | 39 | estagnou | 56 | final |

Média **22,43 ruas [10,85, 35,71]**, contra **4,43** da condição anterior nas mesmas sete seeds e **2,72** de `always-forward`: Δ pareado **+19,71 [8,14, 33,01]** sobre `always-forward`. Estagnaram 2 de 7 (29%; antes 58%); mortes: carro 3, trem 1, borda 1. As partidas são muito desiguais (4 a 51), e **são sete**: o portão de 100 seeds segue pendente. **Aviso:** as seeds 2 a 5 foram jogadas com uma versão do controlador sem a checagem `canSettle` (esperar na margem até a casa da frente comportar também o descanso ou a linha seguinte), as seeds 6 a 8 com a versão final; a checagem não mudou o teto grátis (48,3 contra 47,5 ruas). Por isso só as seeds 6 a 8 reproduzem do cache.

**5. Custo e orçamento.** Pedido de três perguntas: ~1.750 tokens, ~6,1 neurons no Clef-flash (o 27B custa 6,3×, ~39). As 4 primeiras partidas gastaram 846 neurons (138 chamadas) na conta `df5a…`, mas a rodada planejada para ~900 gastou **1.380** e só parou no teto diário local: `--max-calls` só **para de iniciar** partidas. As 3 últimas custaram 558 neurons na `f173…`. Três sondas (507 + 515 + 542 neurons), as partidas (a rodada de 5 da `df5a…` gastou 1.380: 846 nas 4 que terminaram e o resto na quinta, cortada pelo teto) e o erro do app (49) somam ~3.550 neurons hoje (UTC 2026-10-15), **nenhuma conta acima de 10.000** (`df5a…` 9.057, `f173…` 8.729).

**6. O app, e o que errei.** O app passou a abrir no Clef-flash num mapa em cache. Abrindo-o na seed 2, ele **gastou 49 neurons**: as decisões das seeds 2 a 5 só se repetem se o controlador fizer os mesmos movimentos de quando foram gravadas, e o controlador tinha mudado entre as rodadas. Conferir cada seed com `pnpm bench run ... --daily-neurons 0` (qualquer pedido novo é recusado e nada é gasto) mostrou que só as seeds 6, 7 e 8 reproduzem inteiras (20, 19 e 56 acertos de cache). O app lista **6 a 8**.

Nada disto toca o que valia antes: o `json-fx` segue igual a `always-forward`. O Clef do app é uma condição **rotulada** ("palavras, regras no texto, roteamento e controlador de desvio nossos"), não uma prova de que o modelo joga: o controlador planeja a rota, e o modelo só escolhe entre atravessar, contornar por um lado ou esperar.

### O tronco que leva a galinha para fora do mapa: o relógio da plataforma (2026-10-17)

Pedido do dono: "ele não sabe que está num tronco em movimento que logo vai sair do mapa e vai dar game over". Diagnóstico sem rede, nas partidas em cache e no `exec-route`; o que se mediu com o modelo veio de 114 estados de sonda e de 3 partidas ([ADR-0011](adr/0011-controlador-com-rota-e-tres-consultas.md), adendo; [ADR-0009](adr/0009-percepcao-memoria-e-julgamento.md), adendo).

**1. O que acontecia.** Seed 6 (Clef-flash, 9 ruas, borda): a galinha pulou duas vezes para um rio cujo tronco corria para a esquerda a 3,3 colunas/s e cuja linha seguinte só tinha troncos parados do outro lado, e esperou até passar de -5 (`detour_*` recusados, `wait_here` ×4: "nowhere safe to step"). **Nenhuma das três perguntas lia `carried_towards` nem `place_in_world`**, então o modelo não tinha como fazer outra coisa. Seed 7 (8 ruas, carro): esperou numa estrada um tronco passar na linha da frente, fugindo de um carro para o lado em que ele ia, até a borda.

**2. As mortes do `exec-route` (escolhedor ideal, sem modelo; 100 seeds; 31 mortes), pela última jogada antes de morrer:**

| Causa | Mortes |
|---|---|
| esperando numa estrada ou num trilho ("a galinha não pode ficar onde está") | 14 |
| num tronco levado para fora do mapa | 9 |
| carro **logo depois de sair de um tronco** | 6 |
| trem | 2 |

53% dos passos "parado" acontecem fora da grama (28% em tronco, 20% em estrada, 6% em trilho). O terceiro item era um erro do controlador: saindo de um tronco a galinha está numa coluna **fracionária** (0,7), o salto à frente vai até a coluna arredondada (1) e a conferência da janela olhava só a de destino; a galinha entra na estrada ainda a meio caminho (reproduzido tick a tick na seed 58: morre no tick 3 do salto). `hopWindow` confere as duas colunas.

**3. O controlador, medido de graça (100 seeds, `exec-route`).**

| Versão | Ruas | Mortes (carro / borda / trem) |
|---|---|---|
| antes | 47,5 | 19 / 9 / 3 |
| só a correção do salto fracionário | 48,7 | 15 / 10 / 3 |
| **final** (+ relógio, `leave_platform` só com a borda "a_moment" e a saída para a frente antes da de trás) | **48,3** (mediana 39) | 16 / 11 / 3 (total 31 → 30) |

O que **não** valeu, medido e descartado: sair da plataforma com a borda a menos de 2,5 s (`soon`) pela saída mais curta: 27,2 ruas; só com `a_moment` (menos de 1 s): 42,1, porque a saída mais curta era **voltar** e a galinha **embarcava no mesmo tronco, saía e embarcava de novo**; com "para a frente antes de voltar" (o que ficou): 48,3 só com `a_moment` e 46,7 também com `soon`; o limiar de `a_moment` em 0,6 s: 46,3 ruas e 15 mortes na borda; em 1,5 s: 47,5; em 2,0 s: 45,4; **não embarcar** num tronco que sai do mundo antes de a galinha poder seguir: **48,3 → 39,2 / 31,8 / 25,2 ruas** (limiares de 1,0 / 1,5 / 2,5 s), com a borda indo de 11 mortes a 3 / 1 / 0, porque ela passa a esperar na margem até o fim (estagnação 54% → 66% / 79% / 84%); e "sobreviver 8 a 24 saltos" na retenção: sem ganho. **Nenhum remendo simples tira a espera em estrada**; o plano não promete ganho de placar além da correção do salto.

**4. O modelo lê o relógio? A sonda de plataforma** (114 estados: os 90 de antes, sem mudança de id nem de resposta, mais 12 `platform-edge`, a uma palavra da borda, e 12 `platform-far`; ~330 a 350 neurons por variante, 45 chamadas):

| Redação da 4ª pergunta (`ride`) | `platform-edge`: respondeu `leaving` | `platform-far`: respondeu `leaving` | P(leaving) na borda / longe | Concordância geral |
|---|---|---|---|---|
| "a plataforma está para levá-la para fora do mundo?" (mais o texto do jogo) | 3 de 12 | 0 de 12 | 0,17–0,62 / 0,04–0,15 | 86% |
| com o motivo, as faixas de tempo e mais exemplos | 0 de 12 | 0 de 12 | 0,19–0,44 / 0,08–0,23 | 82% |
| **"`chicken.edge_in` é `a_moment`?"** (um campo, só a palavra) | **12 de 12** | **0 de 12** | **0,73–0,90 / 0,05–0,11** | **95%** |

Como nas outras condições, **o texto da opção decide**: pedindo o julgamento ("vai para fora?"), o modelo respondia `staying` quase sempre, embora desse mais probabilidade a `leaving` nos estados da borda (ordem certa, nunca acima de 0,5); pedindo a consulta de uma palavra, acertou todos. O ideal da sonda agora é `leave_platform` quando `edge_in` é `a_moment` (`routeChoice`), por isso a concordância dos 90 estados antigos passou de 94% para 93% (84 de 90).

**5. Partidas** (seeds 6 a 8, Clef-flash, o mesmo `clef:clef-flash:scene:route:lookup` com a 4ª pergunta): **9, 8 e 39 ruas, as mesmas de antes** (30, 72 e 171 decisões, as mesmas), 94 acertos de cache e 29 chamadas novas (212 neurons: a pergunta nova só aparece nos 31 estados em plataforma). Na seed 6 o modelo respondeu `leaving` nos **5 estados a um instante da borda** (P 0,79 a 0,90) e o controlador recusou os cinco com "no way off within 8 hops; nowhere safe to step": **não havia saída em 8 saltos** (a galinha já tinha embarcado num tronco rápido, e à frente só havia água e troncos parados do outro lado). Saber não bastou: a morte foi decidida ao **embarcar**, e a regra que impediria isso custa mais ruas do que salva (item 3). As três partidas continuam reproduzindo do cache com `--daily-neurons 0` (94 acertos, 0 chamadas), então o app segue listando **6 a 8**.

**6. Custo.** Hoje (UTC 2026-10-17), na conta do `.env`: 225 (primeira regravação, com a redação nova ainda não escolhida) + 337 + 350 + 327 (três sondas) + 212 (partidas finais) = **1.451 neurons**, de 10.000. As corridas usaram `--daily-neurons` de 1.500 a 3.000 e `--root` apontando para o checkout principal, para que o razão (`runs/cache/spend.ndjson`) e o cache sejam os mesmos do app.

**7. O que a tela mostrava errado** (auditoria; o que mudou está em [08](08-ui-desktop.md)): em **21 das 95 decisões** gravadas (22%) a barra maior da bússola não era a jogada escolhida (as barras eram probabilidades conjuntas, a escolha é uma cascata de argmax: com P(stand) 0,45 e P(moving) 0,5 a chance conjunta de atravessar é 0,725, mas as duas respostas, uma a uma, dizem "não" e "parada"); uma manobra recusada aparecia como "Go straight"; 5% dos passos de espera diziam "vehicle" com a casa da frente vazia (era a linha **depois** que bloqueava, ou um trem).

**Não medido:** o portão de 100 seeds (segue pendente; ~25.000 a 30.000 neurons); o efeito do relógio em partidas longas (são três seeds, todas iguais às de antes); o tempo real (o movimento é calculado no mundo do pedido e jogado no mundo de agora, e os contadores `n/15` contam quadros: pergunta aberta em [08](08-ui-desktop.md)).

## Atraso: a pergunta do modo tempo real

O modelo responde em ~330 ms (mediana medida do Brasil, [05](05-integracao-clef.md)), e o jogo não espera. Com a **latência injetada** (determinística, sem rede) medi o efeito nas referências gratuitas, 100 seeds:

| Política | sem atraso | 300 ms serial | 300 ms pipelined | 800 ms serial | 800 ms pipelined |
|---|---|---|---|---|---|
| `always-forward` | 3,78 | 3,32 | 3,57 | 3,37 | 3,39 |
| `lookahead` (estado velho) | 44,75 | 6,48 | 11,70 | 4,25 | 4,60 |
| `lookahead-comp` (planeja sobre o estado previsto) | — | 11,92 | **20,52** | 7,35 | 8,64 |

- **Serial**: a pergunta sai, o mundo corre pela latência com o herói parado, a ação vale depois. **Pipelined** (como o app em tempo real): a próxima pergunta sai logo após a ação, então o salto acontece durante a espera.
- **Correção de 2026-10-14 (fila de entrada, [04](04-game-core.md) D9):** as duas células `lookahead` em *pipelined* eram 8,33 e 4,52; com o núcleo corrigido ficaram 11,70 e 4,60. O planejador pergunta com o herói ainda no ar e simula a ação sobre esse estado: antes, o "salto encadeado" do original lhe parecia um atalho que o jogo real não oferece; agora o plano é feito sobre a mesma física. As demais células (serial, `always-forward`, `lookahead-comp`) não mudaram.
- Dois efeitos distintos: (1) **informação velha**: o plano vem de um estado que já mudou (a compensação recupera parte); (2) **exposição**: o herói fica parado em estrada, trilho ou tora enquanto espera (nenhuma previsão elimina isso; só o pipelining ajuda).
- Mesmo um planejador exato e compensado perde mais da metade da pontuação com 300 ms e quase tudo com 800 ms. **Qualquer expectativa de bom desempenho em tempo real precisa partir disso**, e é por isso que o gate usa passo-a-passo.

## Orçamento

Regra do dono: ficar no free tier, **10.000 neurons por dia UTC** (renova às 21:00 no Brasil).

- Medido: ~1.120 tokens por decisão `choice` (JSON), ~1.163 (JSON relativo), ~1.320 (grade), ~3.070 (`critic`); Clef-flash a 3.455 neurons por milhão de tokens e Clef 27B a 21.818 (6,3×).
- O `bench` recusa a chamada **antes de enviá-la** quando o ledger (`runs/cache/spend.ndjson`) chega ao limite; o teto só pode ser reduzido (`--daily-neurons`). As execuções da conta nova usaram `--daily-neurons 9000` (10% de folga).
- O ledger é **por conta** (a cota gratuita é por conta): o gasto da conta antiga continua marcado como dela e não bloqueia a nova, nem some.
- O app desktop aplica o mesmo teto no Rust, como constante, com a mesma marcação por conta.
- Um registro honesto: em 2026-10-14 a conta antiga recebeu ~26.300 neurons (2,6× o free tier; ~US$ 0,18 cobrados), porque o orçamento só passou a ser imposto depois. A conta nova ficou em 6.673 de 10.000. Ver [ADR-0008](adr/0008-orcamento-diario-no-free-tier.md).
- O cache de decisões (`runs/cache/clef.ndjson`, ~3.500 respostas) é grátis e sempre permitido: reexecutar seeds já jogadas não gasta nada.
