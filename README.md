# Clef Crossy Road

Experimento: o modelo **Clef-flash** da Cloudflare (Workers AI) joga uma versão determinística do
[Expo-Crossy-Road](https://github.com/EvanBacon/Expo-Crossy-Road) do Evan Bacon, tomando 100% das decisões de movimento.
Um app desktop (Tauri) mostra a galinha cruzando as ruas com um painel da IA: a ação escolhida, a probabilidade de cada ação, a latência
e quantas ruas ele atravessou. Um benchmark em CLI compara modelos nas mesmas seeds. Nada é publicado na Cloudflare: só se chama a API REST do Workers AI.

## Onde estamos (2026-10-14)

- **Construído e testado:** núcleo determinístico, cliente do Clef com orçamento por conta, agentes, benchmark com IC de 95% e diagnóstico, app desktop a 180 fps.
- **Resultado:** **nenhum modelo testado supera "sempre em frente"** (~3,8 ruas; o teto de referência exato faz ~45). Clef-flash em JSON, grade ou manual mínimo
  empata; com imagem é pior; o Clef 27B escolheu avançar em todas as decisões. A causa medida: 72% a 85% dos saltos para a água são fatais e a probabilidade
  do modelo não distingue os seguros. Leia [docs/07-experimentos.md](docs/07-experimentos.md).
- **Regra do projeto:** ficar no free tier (10.000 neurons por dia UTC, por conta). O código recusa chamadas além disso ([ADR-0008](docs/adr/0008-orcamento-diario-no-free-tier.md)).

## Começar

```bash
pnpm install
node scripts/fetch-assets.mjs          # baixa os modelos do Evan (não vão para o git)
pnpm typecheck && pnpm lint && pnpm test

pnpm --filter @ccr/desktop tauri dev   # abre o app (precisa do Rust: rustup)
pnpm bench plan --policies lookahead,always-forward --seeds 1..100
pnpm bench run  --run minha-execucao --policies always-forward,random,lookahead --seeds 1..100
pnpm bench report --run minha-execucao
```

Antes de qualquer execução com modelo, rode `pnpm bench plan`: ele estima os neurons e divide a execução em dias que cabem no free tier.

## Configuração

1. Copie `.env.example` para `.env` e preencha `CF_API_TOKEN` e `CF_ACCOUNT_ID`.
2. O token deve ter **só** a permissão *Workers AI* e uma data de expiração.
3. O `.env` é ignorado pelo git. Nunca o publique nem o cole em conversas.

Requisitos: Node 24, pnpm 10, Rust (para o app desktop) e o WebView2 (já vem no Windows 11).

## Por onde ler

| Quero… | Leia |
|---|---|
| Saber se a ideia deu certo | [docs/00-viabilidade.md](docs/00-viabilidade.md) e [docs/07-experimentos.md](docs/07-experimentos.md) |
| Entender a arquitetura | [docs/02-arquitetura.md](docs/02-arquitetura.md) |
| Ver como o jogo foi portado | [docs/04-game-core.md](docs/04-game-core.md) |
| Ver como o Clef é chamado e quanto custa | [docs/05-integracao-clef.md](docs/05-integracao-clef.md) |
| Usar o app | [docs/08-ui-desktop.md](docs/08-ui-desktop.md) |
| Saber o que fazer a seguir | [docs/09-roadmap.md](docs/09-roadmap.md) |
| Índice completo | [docs/README.md](docs/README.md) |

Instruções para agentes de IA: [AGENTS.md](AGENTS.md).
