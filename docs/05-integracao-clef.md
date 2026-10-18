# 05 · Integração com o Clef (Workers AI, REST)

> **Status:** contrato verificado por execução real; configuração local testada sem API · **Verificado em:** 2026-10-18 · **Fontes:** [references.md](references.md)
> Legenda de evidência: **[doc]** documentação oficial · **[ind]** teste independente, amostra pequena · **[obs]** observado neste projeto em 2026-10-14.

## Endpoint

```
POST https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/@cf/cloudflare/clef-flash
Authorization: Bearer {CF_API_TOKEN}
Content-Type: application/json
```

Modelos disponíveis: `@cf/cloudflare/clef-flash` (9B), `@cf/cloudflare/clef` (27B), `@cf/cloudflare/clef-omni`
(texto, imagem, áudio, vídeo). Não há Worker nem deploy: só esta chamada REST ([ADR-0002](adr/0002-workers-ai-rest-sem-deploy.md)).

## Configurar pela interface

No app desktop ou no navegador de desenvolvimento: **Setup → Cloudflare → Configure**.
Informe **Account ID** (`CF_ACCOUNT_ID`, 32 caracteres hexadecimais) e **API token** (`CF_API_TOKEN`,
com permissão Workers AI), depois **Save credentials**. O formulário aceita novas credenciais;
os valores já salvos nunca são preenchidos de volta. O status confirma a configuração local;
a autenticação é conferida na próxima decisão que precisar da API.

O backend grava o `.env` da raiz e aplica a nova conta sem reiniciar o app. A partida fica pausada;
um pedido pendente ou uma tentativa que parou com erro é descartado/reiniciado na mesma seed.
O usuário retoma com Resume. Salvar não gasta neurons e não altera o ledger.
Outros processos já abertos precisam ser reiniciados para ler as novas credenciais.

Referências: [encontrar o Account ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)
e [configurar um token para Workers AI](https://developers.cloudflare.com/workers-ai/get-started/rest-api/).

## Request

```json
{
  "model": "clef-flash",
  "state": { "...": "objeto, array ou string (ver 06)" },
  "questions": {
    "move": {
      "type": "choice",
      "instructions": "Texto fixo e versionado com as regras do jogo.",
      "criteria": {
        "hop_forward": "Hop one row forward (dz +1), same column.",
        "hop_back": "Hop one row backward (dz -1), same column.",
        "hop_left": "Hop one column to the left, same row.",
        "hop_right": "Hop one column to the right, same row.",
        "stay": "Do not move this turn."
      }
    }
  },
  "images": ["data:image/png;base64,..."]
}
```

Tipos de pergunta [doc]: `choice` (uma opção de `criteria`), `noul` (probabilidade de "sim"), `score` (nível de uma lista ordenada).
`images` é opcional, máximo 4.

## Resposta (REST) [obs]

```json
{
  "result": {
    "model": "clef-flash",
    "answers": { "move": { "type": "choice", "choice": "hop_forward",
      "probabilities": { "hop_forward": 0.8839, "hop_back": 0.0475, "hop_left": 0.0239, "hop_right": 0.032, "stay": 0.0127 },
      "confidence": 0.7316 } },
    "usage": { "input_tokens": 444, "output_tokens": 0 }
  },
  "success": true, "errors": [], "messages": []
}
```

- Uma pergunta `noul` volta como `{ "type": "noul", "noul": 0.4564 }`: o número está no campo `noul` [obs].
- O binding de Worker devolve o conteúdo de `result` direto; o REST embrulha. O `@ccr/clef` normaliza com `json.result ?? json`.
- As probabilidades vêm arredondadas a 4 casas [ind]. A mesma requisição repetida deu probabilidades idênticas [obs].

## Armadilhas

| Fato | Evidência |
|---|---|
| `instructions` é obrigatório em cada pergunta; sem ele a API devolve **400** com a mensagem genérica "required properties at '/' are 'model,state,questions'" (a mensagem não aponta o campo real) | [obs], [ind] |
| `model` consta como obrigatório na doc, mas o REST **aceitou uma requisição sem ele (200)**. Continuamos enviando, porque a doc o exige | [doc] vs [obs] |
| Chaves de objeto em `state` são ordenadas alfabeticamente; use **array** para qualquer coisa com ordem (`lane_10` vem antes de `lane_9`) | [ind] |
| IDs de opções são ordenados como string e entram no texto do modelo: use IDs descritivos. A ordem das opções não importa | [ind] |
| `choice` sempre devolve uma opção, mesmo que nenhuma sirva | [ind] |
| `confidence` não é documentado e não é a maior probabilidade; mostrar rotulado à parte | [ind], [obs] |
| `state` longo é truncado **do fim** | [ind] (lendo o código de inferência) |
| Perguntas no mesmo request podem se influenciar; para medir cada uma, use requests separados | [ind] |
| Imagens: base64 apenas (nada de URL), PNG/JPEG/WebP, até 4; ≤ 4 MiB e ≤ 16 MP cada; total ≤ 8 MiB; tokens ≈ `(w/32)·(h/32) + 3`, teto de 1.024 por imagem | [doc] |
| Contexto hospedado de 24.576 tokens (o post de lançamento ainda diz 64K, e o changelog de 2026-10-09 reduziu para 24K) | [doc] |

## Preço, limites e custo

| Item | Clef-flash | Clef (27B) | Fonte |
|---|---|---|---|
| US$ por milhão de tokens de entrada | 0,038 | 0,240 | [doc] |
| Neurons por milhão de tokens | 3.455 | 21.818 | [doc] |
| Tokens de saída | não cobrados | não cobrados | [doc] |
| Free tier | 10.000 neurons/dia, reinicia às 00:00 UTC; acima disso exige Workers Paid | | [doc] |
| Rate limit | **não documentado para o Clef**. O padrão de text-generation é 300 req/min | | [doc] |
| Concorrência: 5 requests em paralelo | todas 200, sem 429 | | [obs] |

Conta de uma chamada com o prompt do teste (444 tokens de entrada, a maior parte é a instrução fixa):
≈ 1,5 neurons no Clef-flash (≈ US$ 0,000017) e ≈ 9,7 no Clef 27B. No free tier cabem ≈ 6.500 chamadas/dia no Clef-flash
e ≈ 1.000 no 27B. Um estado de 10 linhas será maior; **medir na Fase 2**.

## Latência [obs]

Medida de Node, no Brasil, em 20 chamadas sequenciais com o mesmo estado (conexão reaproveitada):

| | p50 | p95 | mín | máx |
|---|---|---|---|---|
| Clef-flash, ida e volta | **326 ms** | 764 ms | 300 ms | 764 ms |

- A primeira chamada (conexão fria) levou 994 ms.
- Isso é ≈ 8x a mediana de 38,8 ms divulgada pela Cloudflare, que é do lado do servidor [doc]; o restante é rede.
  Um teste independente do Japão deu 166 ms [ind].
- Consequência: ≈ 3 decisões/s no máximo. Um carro a 4,8 tiles/s anda ≈ 1,6 tile em 326 ms. O modo de tempo real exige
  compensar a latência; o gate usa o modo passo-a-passo ([02](02-arquitetura.md)).

## Política de erro do cliente

Erros já classificados pelo transporte são preservados como `ClefError`: autenticação, cota e
pedido inválido não são convertidos em falhas de rede retentáveis. No app, as pontes Rust/Vite
adicionam códigos estáveis para a tradução da interface; a mensagem diagnóstica original continua
em inglês. Isso não muda o contrato REST nem os dados do cache. Ver [i18n](12-i18n.md).


| Situação | Ação |
|---|---|
| 429 de rate limit | Retry com backoff exponencial e jitter (máx. 4 tentativas, respeita `Retry-After`); metade da concorrência |
| 429 "Capacity temporarily exceeded" (3040) ou 5xx | Retry com backoff; **sem** reduzir a concorrência |
| Mensagem de cota diária da Cloudflare ou orçamento local esgotado | Fatal: parar a execução inteira; nada é repetido |
| 400 | Não repetir; é bug de payload. Registrar a requisição (sem token) |
| 401/403 | Parar a execução inteira e avisar |
| Timeout (10 s por chamada) | Tratar como falha de rede; 1 retry |
| Resposta fora do schema | Falha explícita; nunca "adivinhar" uma ação |

O cache por hash do request evita gastar neurons ao repetir uma seed. A chave inclui modelo, estado serializado,
perguntas e a versão do prompt.

## Achados de campo da Fase 2 (2026-10-14)

| Achado | Detalhe |
|---|---|
| **Erro de capacidade, código 3040** | `HTTP 429` com "AiError: Capacity temporarily exceeded, please try again". Apareceu em ~1 de 30 chamadas durante rajadas, **mesmo com 4 requisições em paralelo**, enquanto 16 em paralelo logo depois passaram todas. É capacidade momentânea do serviço, não o limite da conta: o cliente repete com backoff e **não reduz a concorrência** (tipo `capacity`) |
| Latência sob carga | Com 4–6 requisições em paralelo, a mediana subiu para ~930 ms (p95 ~3,3 s) e com prompts de ~1.100 tokens. A mediana de 326 ms é de chamadas **sequenciais** com um prompt pequeno. Para medir latência, rodar com `--concurrency 1` |
| Tokens reais por decisão | `choice` JSON: **~1.120** (estado de 12 linhas); `choice` JSON relativo (`json-rel`): ~1.163; `choice` `json-fx` (com memória e previsão): ~1.425; `view`: ~1.367; `view-fx`: ~1.540; `choice` grade: ~1.320; `critic` (cinco perguntas `noul`): **~3.070**. O estado mínimo da sonda tinha 444 |
| Cobrança além do free tier (conta antiga) | As chamadas **continuaram funcionando** após passar de 10.000 neurons no dia (foram ~26.300). Quer dizer que aquela conta era cobrada além do free tier (~US$ 0,18 no total), e por isso o projeto agora impõe o teto sozinho ([ADR-0008](adr/0008-orcamento-diario-no-free-tier.md)) |
| Respostas determinísticas | A mesma requisição devolve as mesmas probabilidades, então o cache de decisões é válido |
| Imagens | **Funcionam como `data:image/png;base64,...`** (verificado em 2026-10-14, 365 chamadas no Clef-flash). A imagem E2 de 416×384 custa ~972 tokens por decisão no total, com o texto das instruções |
| Custo medido no Clef 27B | 24,5 neurons por decisão (3.507 neurons para 143 chamadas), a mesma conta do preço publicado: 6,3× o Clef-flash |
| Contas | A cota gratuita é por conta. O ledger local é por conta (marca FNV-1a do ID); ver [ADR-0008](adr/0008-orcamento-diario-no-free-tier.md) |

## Política de orçamento nas chamadas

Toda chamada passa pelo `ClefClient` com um `SpendBudget`, que **recusa antes de enviar** quando o gasto do dia (UTC) atingiu o
limite. Um erro `quota` é fatal e traz "Nothing was sent". Acertos de cache sempre passam. No app desktop o Rust aplica o mesmo
teto e grava o ledger. Ver [ADR-0008](adr/0008-orcamento-diario-no-free-tier.md) e [10](10-seguranca-e-licencas.md).

## Smoke test (reutilizável, respeita o orçamento)

**Não chame a API com `curl` ou scripts avulsos**: eles não passam pelo ledger. Use o CLI, que mostra o orçamento antes e depois:

```bash
pnpm bench plan --policies clef:clef-flash:json:choice:full --seeds 1       # estima, não chama
pnpm bench run  --run smoke --policies clef:clef-flash:json:choice:full --seeds 1 --max-calls 3
```

Esperado (com orçamento disponível): 1 partida jogada, 2 a 5 chamadas, `budget: X / 10000 neurons spent today`.
Com o orçamento estourado: `STOPPED: quota: Local daily budget reached ... Nothing was sent.` e zero chamadas.

## Perguntas abertas

1. Qual é o rate limit real do Clef? Com 16 requisições em paralelo não apareceu um 429 de rate limit (só o 3040 de capacidade), mas não foi explorado além disso, por causa do orçamento.
2. O comportamento sem `model` é estável ou um acaso da implementação? Não depender dele.
3. ~~Quantos tokens custa um estado completo?~~ Respondido: ~1.120 (`choice` JSON). Falta medir a imagem (E2).
4. ~~Imagens: data URL ou base64 puro?~~ Respondido: data URL funciona.
5. O modelo hospedado muda sem aviso? O changelog de 2026-10-09 diz que o Clef ficou até 2x mais rápido "com os pesos inalterados".
   Registrar data e `usage` em todo resultado.
