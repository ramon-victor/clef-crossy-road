# 00 · Viabilidade

> **Status:** rascunho · **Verificado em:** 2026-10-14 · **Fontes:** [references.md](references.md)

## Veredito

**Faz sentido como experimento.** O custo é baixo, o ciclo de feedback é rápido e a pergunta é clara: um modelo de
decisão de 9B, que devolve probabilidades por opção, consegue jogar um jogo de reflexo espacial?
**Não é garantido que consiga.** O projeto está desenhado para descobrir isso cedo (gate da Fase 2) e barato.

## Checagem de fatos do texto original

| Afirmação | Resultado | Observação |
|---|---|---|
| Clef-flash é um modelo de 9B que recebe JSON/texto/imagem e devolve escolhas com probabilidades | Confirmado | `@cf/cloudflare/clef-flash`; tipos `noul`, `choice`, `score`; até 64 perguntas e 4 imagens por request |
| US$ 0,038 por milhão de tokens de entrada | Confirmado | Corte de US$ 0,090 em 2026-10-09. Saída não é cobrada. 3.455 neurons por milhão de tokens |
| Atualização de 9 de outubro de 2026 | Confirmado | Clef-omni lançado, preço do Clef-flash cortado, Clef até 2x mais rápido, **contexto hospedado do Clef-flash reduzido de 64K para 24K** |
| Exemplo de código com `model: "clef-flash"` no body | Correto | A doc exige o campo mesmo com o modelo na URL |
| `response.answers.move.choice` | Correto só para o binding de Worker | No REST o resultado vem em `result.answers.move.choice` |
| Clef-flash aceita imagens (não precisa do Clef-omni) | Confirmado | O Clef-omni acrescenta áudio e vídeo |
| Latência baixa | Parcial | 38,8 ms de mediana é da Cloudflare, no servidor. Um teste independente do Japão mediu 166 ms de ida e volta. **Latência do Brasil: ver [05](05-integracao-clef.md)** |
| Expo Crossy Road: MIT, Three.js, versão web | Confirmado para o código | Three r182, Expo 54. Assets são réplicas de Crossy Road; o autor alega fair use educacional |
| "crossy-js" como base mais direta | Não recomendado | Existe (`SepraDC/crossy-js`), mas é 1 commit, 0 estrelas, sem trens, sem LICENSE detectado e não é o jogo do Evan |
| Comparar Clef, Clef-flash e Jev | Parcial | Clef, Clef-flash e Clef-omni estão no Workers AI. Não confirmei como acessar o Jev |
| "Mesma seed" entre modelos | **Impossível com o código original** | Ver abaixo |

## Três correções que moldam o projeto

1. **O código original não é reproduzível.** Usa `Math.random` sem seed em toda a geração de mapa e de tráfego, e
   move os carros por frame (o parâmetro `dt` é passado e ignorado). Resultado: dois modelos nunca jogam o mesmo
   mapa, e a velocidade depende da taxa de quadros da tela. Solução: núcleo determinístico
   ([ADR-0001](adr/0001-core-headless-e-port-das-regras.md), [ADR-0004](adr/0004-simulacao-deterministica.md)).
2. **O estado de exemplo cobre só rua e grama.** O jogo tem também árvores, trilho com trem e semáforo, rio com
   toras e vitórias-régias. Ver [04](04-game-core.md).
3. **O risco é a capacidade do modelo, não a integração.** O Clef foi treinado e avaliado para roteamento e triagem
   (classificar um estado em opções). O post de lançamento não menciona controle sequencial, jogos nem tempo real.
   Decidir se um carro a ~3 tiles/s chega à coluna do jogador antes do próximo salto é aritmética espaço-temporal.
   Um classificador pode ir mal nisso em zero-shot.

## Riscos

| # | Risco | Mitigação |
|---|---|---|
| 1 | O Clef-flash não supera um baseline trivial | Gate go/no-go na Fase 2; encoder em grade; Clef (27B) e Clef-omni como comparação |
| 2 | Port infiel às regras do Evan | Testes dourados que citam o arquivo de origem; perguntas abertas em [04](04-game-core.md) |
| 3 | Latência inviabiliza tempo real | Começar em passo-a-passo; modo de latência injetada no benchmark |
| 4 | Custo e rate limit desconhecidos para o Clef | Medir tokens por decisão e 429 na Fase 0/2; cache de decisões |
| 5 | Vazamento do token | [10](10-seguranca-e-licencas.md) |
| 6 | IP dos assets | [10](10-seguranca-e-licencas.md); uso local |
| 7 | WebGL sob WebView2 sem benchmark conhecido | Medir FPS no início da Fase 3 |

## Atualização após as Fases 2 a 4 (2026-10-14)

Os riscos 1 e 3 da tabela acima se materializaram:

- **Risco 1 (o modelo não supera o baseline): confirmado em 9 condições.** O Clef-flash, em JSON, em grade ASCII, com a estratégia `critic-go`,
  com o manual mínimo e com as colunas medidas a partir da galinha (`json-rel`, 40 seeds), é **indistinguível de "sempre em frente"** (≈ 3,7 ruas contra 3,78; diferenças pareadas com IC cruzando zero). Com **imagem (E2)
  é significativamente pior** (−0,42 [−0,82, −0,05]) e o **Clef 27B** escolheu avançar em todas as decisões (Δ 0,00). O gate não passou ([07](07-experimentos.md)).
  Só o `clef-omni` ficou sem teste.
- **O porquê, medido:** a água decide o jogo (72% a 85% dos saltos para a água são fatais) e a probabilidade de `hop_forward` não distingue saltos
  seguros de fatais dentro da água (AUC 0,51 a 0,63). O 27B tem AUC geral de 0,75, mas só por separar tipos de terreno, não por ler posições e velocidades.
- **Risco 3 (latência): quantificado.** Mesmo um planejador exato que enxerga o estado cai de 44,8 para 6,5 ruas com 300 ms de atraso;
  compensando a previsão e sobrepondo o salto à espera chega a 20,5, e com 800 ms nada passa de ~8,6. Tempo real é muito mais difícil do que passo-a-passo.
- **O que deu certo:** o núcleo determinístico, o app desktop a 180 fps com o painel da IA, o benchmark pareado com IC, e um orçamento diário imposto no código.
- **Um erro nosso:** o projeto gastou ~26.300 neurons num dia (2,6× o free tier, ~US$ 0,18) antes de o orçamento ser imposto; isso foi corrigido ([ADR-0008](adr/0008-orcamento-diario-no-free-tier.md)).
- **Veredito revisado:** o experimento é válido e barato, e o resultado até agora é **negativo para o Clef-flash zero-shot**. O valor do projeto
  passa a ser (a) o ambiente reproduzível e o app para observar o modelo, (b) um resultado honesto, e (c) a base para fine-tuning por RL,
  que é o caminho natural quando um modelo de decisão não generaliza para controle espaço-temporal.

## Resultado do primeiro teste do Clef (2026-10-14)

Executado em Node, a partir do Brasil, com scripts descartáveis (não estão no repo). ≈ 105 chamadas no total, estimadas em
≈ 0,5 mil neurons dos 10.000 diários gratuitos.

### O que ficou confirmado

- **Contrato REST** e formato da resposta: ver [05](05-integracao-clef.md). Respostas determinísticas (a mesma requisição
  repetida deu probabilidades idênticas). 5 chamadas em paralelo, todas 200.
- **Latência do Clef-flash, ida e volta:** p50 **326 ms**, p95 764 ms (20 chamadas sequenciais); chamada fria 994 ms.
  Bem acima dos 38,8 ms divulgados, que são do lado do servidor.
- **Tokens:** 444 de entrada para um estado mínimo; a instrução fixa domina. Saída é 0.

### Sonda de capacidade: 12 cenários feitos à mão

Cada cenário tem uma resposta aceitável definida por mim (cenários 3, 7, 8 e 12: avançar mata; 1, 4, 5, 6, 9: avançar é
seguro; 2 e 11: árvore à frente; 10: o jogador está numa rua com carro iminente). Valores abaixo: probabilidade de
`hop_forward` na pergunta `choice` (E0, JSON) e probabilidade de morrer ao avançar na pergunta `noul`.

| # | Cenário | Avançar é | Flash `choice` P(frente) | Flash `noul` P(morre) | 27B `choice` P(frente) | 27B `noul` P(morre) |
|---|---|---|---|---|---|---|
| 1 | Grama livre | seguro | 0,88 | 0,04 | 0,90 | 0,03 |
| 2 | Árvore à frente | bloqueado | 0,63 | 0,62 | 0,78 | 0,06 |
| 3 | Carro cruzando minha coluna | **fatal** | 0,59 | 0,36 | 0,71 | 0,64 |
| 4 | Carro se afastando | seguro | 0,65 | 0,05 | 0,71 | 0,42 |
| 5 | Carro distante se aproximando | seguro | 0,56 | 0,07 | 0,74 | 0,45 |
| 6 | Tora sob minha coluna | seguro | 0,83 | 0,26 | 0,82 | 0,65 |
| 7 | Água sem tora | **fatal** | 0,56 | 0,06 | 0,44 | 0,54 |
| 8 | Trem chegando, semáforo ligado | **fatal** | 0,54 | 0,15 | 0,35 | 0,61 |
| 9 | Trem longe, semáforo desligado | seguro | 0,56 | 0,05 | 0,68 | 0,58 |
| 10 | Carro iminente na minha rua | escape | 0,87 | 0,06 | 0,61 | 0,11 |
| 11 | Árvore à frente e à esquerda | bloqueado | 0,87 | 0,13 | 0,70 | 0,07 |
| 12 | Carro passando, esperar | **fatal** | 0,60 | 0,13 | 0,69 | 0,44 |

| Condição | Acertos em 12 | Ações escolhidas |
|---|---|---|
| Referência: `always-forward` | 6 | sempre frente |
| Referência: aleatório uniforme | ≈ 5,2 (esperado) | — |
| Clef-flash, E0 JSON, `choice` | **6** | `hop_forward` em **12/12** |
| Clef-flash, E1 grade ASCII, `choice` | **6** | `hop_forward` em **12/12** |
| Clef 27B, E0 JSON, `choice` | 7 | `hop_forward` em 11/12; `stay` no trem iminente |
| Clef 27B, E1 grade ASCII, `choice` | 3 | frente em 9/12; `hop_back` em dois cenários; `hop_left` em um |

(A taxa de acertos de `noul` com "escolher a ação de menor risco" não é um bom indicador: as probabilidades de risco
das ações seguras são quase iguais e a escolha vira ruído.)

### Leitura (amostra pequena; não conclusiva)

1. **No `choice`, o Clef-flash age como `always-forward`**: escolheu avançar em todos os cenários, em JSON e em grade.
   As probabilidades se mexem (0,88 na grama livre contra 0,54 com o trem chegando), mas nunca o bastante para trocar a ação.
2. **Os modelos leem o tipo de terreno, não a cinemática.** No 27B, avançar para rua, água ou trilho recebe risco de
   0,42–0,65 independentemente de o carro estar longe, se afastando ou iminente (cenários 4, 5, 6 e 9 recebem risco tão
   alto quanto 3, 7 e 8); grama à frente recebe 0,03–0,07. O Clef-flash mostra sinal mais fraco e menos consistente.
3. **Árvores foram ignoradas** no `choice` (cenários 2 e 11).
4. O 27B é um pouco melhor no `choice` (7/12, e o único que escolheu `stay`), mas piora na grade.

### Limitações

n = 12, uma chamada por condição, uma única redação de prompt (que menciona "mover para frente" como objetivo e pode
induzir viés), cenários e respostas aceitas escritos por mim sem o core ainda existir (as regras exatas de salto e de tempo
ainda não foram portadas, ver [04](04-game-core.md)). **Isso não prova que o Clef não consegue jogar**; mostra que o prompt
ingênuo não basta e que o gate da Fase 2 provavelmente falha sem iteração. O plano B está em [07](07-experimentos.md).
