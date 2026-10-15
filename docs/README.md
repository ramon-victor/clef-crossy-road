# Documentação

> **Idioma:** português (BR). Código, identificadores e `AGENTS.md` ficam em inglês.
> **Convenção:** toda página começa com um cabeçalho de *Status* e *Verificado em*. O que não se sabe fica em
> "Perguntas abertas"; nada é chutado. Números só entram se vierem de uma fonte (ver [references.md](references.md))
> ou de uma execução real.

## Índice

| # | Página | Conteúdo |
|---|---|---|
| 00 | [Viabilidade](00-viabilidade.md) | Veredito, checagem de fatos do texto original, riscos |
| 01 | [Visão e escopo](01-visao-e-escopo.md) | Objetivos, não-objetivos, métricas de sucesso |
| 02 | [Arquitetura](02-arquitetura.md) | Camadas, fluxo de dados, regras de dependência |
| 03 | [Stack](03-stack.md) | Escolhas e alternativas descartadas |
| 04 | [Núcleo do jogo](04-game-core.md) | Simulador determinístico e regras portadas do Evan |
| 05 | [Integração com o Clef](05-integracao-clef.md) | Contrato da API, armadilhas, custo, smoke test |
| 06 | [Observação e prompts](06-observacao-e-prompts.md) | Encoders, perguntas, regra de justiça |
| 07 | [Experimentos](07-experimentos.md) | Protocolo do benchmark e estatística |
| 08 | [UI desktop](08-ui-desktop.md) | App Tauri e painel da IA |
| 09 | [Roadmap](09-roadmap.md) | Fases e critérios de saída |
| 10 | [Segurança e licenças](10-seguranca-e-licencas.md) | Token, Tauri, MIT, IP dos assets |
| 11 | [Lições dos 13 jogos do Jev](11-licoes-dos-jogos-do-jev.md) | O que os outros jogos controlados pelo Jev fazem e o que levamos |
| — | [Referências](references.md) | Fontes com URL e data |
| — | [ADRs](adr/) | Decisões de arquitetura registradas |

## ADRs

| ADR | Decisão |
|---|---|
| [0001](adr/0001-core-headless-e-port-das-regras.md) | Núcleo headless + port das regras do Evan |
| [0002](adr/0002-workers-ai-rest-sem-deploy.md) | Workers AI só via REST, sem deploy |
| [0003](adr/0003-typescript-pnpm-monorepo.md) | TypeScript + pnpm workspaces |
| [0004](adr/0004-simulacao-deterministica.md) | Seed, passo fixo de 60 Hz, sem alocação |
| [0005](adr/0005-regra-de-justica-da-observacao.md) | Observação só com fatos físicos |
| [0006](adr/0006-sem-fine-tuning-nem-self-host.md) | Sem fine-tuning nem self-host por ora |
| [0007](adr/0007-desktop-tauri-token-no-rust.md) | Desktop em Tauri, token no Rust |
| [0008](adr/0008-orcamento-diario-no-free-tier.md) | Orçamento diário no free tier, imposto antes da chamada |
| [0009](adr/0009-percepcao-memoria-e-julgamento.md) | Percepção e memória entram na vista do modelo; julgamento não |
| [0010](adr/0010-palavras-regras-e-executor-de-manobras.md) | Palavras, regras nas opções e executor de manobras: níveis de ajuda rotulados |
| [0011](adr/0011-controlador-com-rota-e-tres-consultas.md) | Controlador com rota, vista de cena e três consultas: o nível "assistido na navegação" |

## Como manter

- Mudou um contrato (API, regra do jogo, schema da observação)? Atualize a página e a data de verificação.
- Decisão nova ou revertida? Crie ou altere um ADR; não edite a história em silêncio.
- O Clef tem pouco tempo de vida e a documentação dele já mudou uma vez (contexto de 64K para 24K).
  Reverifique [05-integracao-clef.md](05-integracao-clef.md) antes de cada fase.
