# Clef Crossy Road

Experimento: o modelo **Clef-flash** da Cloudflare (Workers AI) joga uma versão determinística do
[Expo-Crossy-Road](https://github.com/EvanBacon/Expo-Crossy-Road) do Evan Bacon, tomando 100% das decisões de movimento.
Um app desktop (Tauri) mostra a galinha cruzando as ruas com um painel da IA: a ação escolhida, a probabilidade de cada ação, a latência
e quantas ruas ele atravessou. Um benchmark em CLI compara modelos nas mesmas seeds. Nada é publicado na Cloudflare: só se chama a API REST do Workers AI.

## Onde estamos (2026-10-14)

- **Construído e testado:** núcleo determinístico, cliente do Clef com orçamento por conta, agentes, benchmark com IC de 95% e diagnóstico, app desktop a 180 fps.
- **Resultado:** **nenhum modelo testado supera "sempre em frente"** (~3,8 ruas; o teto de referência exato faz ~45). Clef-flash em JSON, grade, colunas relativas à galinha, manual mínimo
  ou com **a vista de um jogador** (a tela inteira, onde as coisas estarão em 0,2 s e a memória das últimas jogadas) empata; com imagem é pior; o Clef 27B escolheu avançar em todas as partidas.
  A causa medida: 72% a 96% dos saltos para a água são fatais e o modelo põe a maior probabilidade em avançar mesmo com a plataforma escrita na frente dele. Jogadores roteirizados que leem
  as mesmas vistas fazem 13 a 19 ruas: a informação está lá, o modelo não a usa. Leia [docs/07-experimentos.md](docs/07-experimentos.md).
- **Para ver o que o modelo recebe:** no app, a tecla **I** abre uma janela com o estado, a pergunta, as opções e a resposta de cada decisão; na linha de comando, `pnpm bench show-input --seed 4 --actions hop_forward`. A revisão mostrou que os dados estão certos e que o texto das opções é o que mais move a escolha do modelo ([docs/06](docs/06-observacao-e-prompts.md), [docs/07](docs/07-experimentos.md)).
- **O app tem um só Clef** (a vista de jogador). Um jogador de IA que passa 40 decisões sem uma linha nova (por exemplo, batendo numa árvore) encerra a partida com o cartão "Preso" e para de gastar.
- **Regra do projeto:** ficar no free tier (10.000 neurons por dia UTC, por conta). O código recusa chamadas além disso ([ADR-0008](docs/adr/0008-orcamento-diario-no-free-tier.md)).

## Ver o jogo rodando

Depois de construir uma vez (comandos abaixo), basta dar **duplo clique**:

| Arquivo | O que abre |
|---|---|
| `play.cmd` | O app no modo normal: o look-ahead (referência gratuita) jogando e reiniciando sozinho. Troque o jogador no seletor |
| `play-clef.cmd` | O **Clef-flash jogando a seed 1**, com as probabilidades reais no painel. Vem do cache, então **não gasta neurons**; a tecla `M` abre o próximo mapa em cache |

No app: setas ou WASD para você jogar, espaço pausa, `N` dá um passo, `R` repete o mapa, `M` abre outro. O painel mostra, a cada decisão, a ação, a probabilidade
de cada ação, a latência, os tokens e quantos neurons do dia já foram usados.

## Começar

```bash
pnpm install
node scripts/fetch-assets.mjs          # baixa os modelos do Evan (não vão para o git)
pnpm typecheck && pnpm lint && pnpm test

pnpm --filter @ccr/desktop build
cd apps/desktop && pnpm tauri build --no-bundle && cd ../..   # gera o .exe de release (precisa do Rust: rustup)
pnpm --filter @ccr/desktop tauri dev   # ou: abre o app em modo de desenvolvimento
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
