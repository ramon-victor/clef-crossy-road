# ADR-0002 · Workers AI só via REST, sem deploy

- **Status:** aceito · **Data:** 2026-10-14

## Contexto

O texto original sugeria `env.AI.run` num Worker. O dono do projeto não quer publicar nada na Cloudflare; só usar o Workers AI.

## Decisão

Chamar `POST /accounts/{id}/ai/run/@cf/cloudflare/{modelo}` com um token de API, a partir de processos locais: Node
(benchmark) e Rust (desktop). Sem Worker, sem wrangler, sem D1/KV/Durable Objects.

## Consequências

- (+) Nenhuma infraestrutura para manter; custo apenas por tokens.
- (+) O binding de Worker devolve o resultado sem o envelope `result`; o REST o embrulha. O cliente normaliza.
- (−) O token precisa viver em máquina local; ver [10](../10-seguranca-e-licencas.md).
- (−) A latência inclui a viagem de rede até a Cloudflare (p50 de 326 ms medido do Brasil, ver [05](../05-integracao-clef.md)).
- (−) Rate limit do Clef não documentado.

## Alternativas

- Worker + binding: latência provavelmente menor entre Worker e modelo, mas exige deploy e publica um endpoint que gasta neurons.
- Auto-hospedar os pesos (Apache 2.0): ver [ADR-0006](0006-sem-fine-tuning-nem-self-host.md).
