# ADR-0006 · Sem fine-tuning nem self-host por ora

- **Status:** aceito (revisável após o gate da Fase 2) · **Data:** 2026-10-14

## Contexto

Os pesos do Clef e do Clef-flash são abertos (Apache 2.0, Hugging Face). A Cloudflare anunciou uma plataforma de fine-tuning
por RL (AI Gateway, Workers AI, Containers como sandboxes, treinador próprio, BYOM), hoje só com apoio de uma equipe
dedicada, e uma versão self-serve prevista. O contexto de 256K só vale para pesos auto-hospedados.

## Decisão

Usar apenas os modelos hospedados, zero-shot, nesta etapa. Não treinar nem hospedar pesos.
O core determinístico e o log de trajetórias (estado, ação, recompensa) já nascem compatíveis com RL, para que a
Fase 5 seja barata se o gate falhar.

## Consequências

- (+) Escopo pequeno e custo trivial.
- (−) Se o modelo zero-shot não passar o gate, a melhora depende de prompt/encoder ou de fine-tuning fora do alcance imediato.

## Alternativas

- Entrar como parceiro de design da plataforma de RL.
- Auto-hospedar o Clef-flash numa GPU local: contexto maior, sem custo por token, mas com operação e sem o ganho de capacidade garantido.
