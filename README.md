# Clef Crossy Road

Experimento: o modelo **Clef-flash** da Cloudflare (Workers AI) joga uma versão determinística do
[Expo-Crossy-Road](https://github.com/EvanBacon/Expo-Crossy-Road) do Evan Bacon, tomando 100% das decisões de movimento.
Um app desktop (Tauri) mostra a galinha cruzando as ruas com um painel da IA: a ação escolhida, a probabilidade de cada ação, a latência
e quantas ruas ele atravessou. Um benchmark em CLI compara modelos nas mesmas seeds. Nada é publicado na Cloudflare: só se chama a API REST do Workers AI.

## Onde estamos (2026-10-15)

- **Construído e testado:** núcleo determinístico, cliente do Clef com orçamento por conta, agentes, benchmark com IC de 95% e diagnóstico, app desktop a 180 fps.
- **Resultado:** as **12 primeiras condições não superam "sempre em frente"** (~3,8 ruas; o teto de referência exato faz ~45). Depois de estudar os 13 jogos controlados pelo Jev de outros projetos ([docs/11](docs/11-licoes-dos-jogos-do-jev.md)), o código passou a dar **palavras** em vez de números, as opções viram **consultas de um campo com exemplos resolvidos** e um **controlador** dá os saltos e **caminha os desvios** ([ADR-0010](docs/adr/0010-palavras-regras-e-executor-de-manobras.md), [ADR-0011](docs/adr/0011-controlador-com-rota-e-tres-consultas.md)). A versão anterior (10,05 ruas, 58% estagnadas) virou a atual: o Clef-flash faz **22,4 ruas em 7 partidas** (contra 4,4 da anterior nas mesmas seeds), estagnou em 2 de 7, e o modelo concorda com o escolhedor ideal das regras em 94% dos estados de uma sonda. É o conjunto todo (palavras, regras, roteamento, rota e instante são nossos), rotulado nos relatórios; o portão de 100 seeds ainda está pendente. Com este controlador, o escolhedor ideal sem modelo (`exec-route`) faz 48,3 ruas: é o teto contra o qual o Clef se compara. As 12 primeiras: Clef-flash em JSON, grade, colunas relativas à galinha, manual mínimo
  ou com **a vista de um jogador** (a tela inteira, onde as coisas estarão em 0,2 s e a memória das últimas jogadas) empata; com imagem é pior; o Clef 27B escolheu avançar em todas as partidas.
  A causa medida: 72% a 96% dos saltos para a água são fatais e o modelo põe a maior probabilidade em avançar mesmo com a plataforma escrita na frente dele. Jogadores roteirizados que leem
  as mesmas vistas fazem 13 a 19 ruas: a informação está lá, o modelo não a usa. Leia [docs/07-experimentos.md](docs/07-experimentos.md).
- **Para ver o que o modelo recebe:** no app, a tecla **I** abre uma janela com o estado, a pergunta, as opções e a resposta de cada decisão; na linha de comando, `pnpm bench show-input --seed 4 --actions hop_forward`. A revisão mostrou que os dados estão certos e que o texto das opções é o que mais move a escolha do modelo ([docs/06](docs/06-observacao-e-prompts.md), [docs/07](docs/07-experimentos.md)).
- **O app tem dois modelos no "Who plays"**: **Clef-flash** e **Clef (27B)**, os dois com a jogabilidade nova (palavras, três consultas e controlador de desvio). No navegador, abre no look-ahead gratuito. O desktop abre no Clef-flash na seed 6; esse replay só é gratuito quando o cache local está presente (seeds 6 a 8). Qualquer outra combinação abre por `CCR_PLAYER`. Um jogador de IA que passa 60 decisões sem uma linha nova (por exemplo, batendo numa árvore) encerra a partida com o cartão "Preso" e para de gastar.
- **Regra do projeto:** ficar no free tier (10.000 neurons por dia UTC, por conta). O código recusa chamadas além disso ([ADR-0008](docs/adr/0008-orcamento-diario-no-free-tier.md)).

## Preparar o ambiente

Instale **Node 24 ou superior** e **Git**. O projeto fixa o **pnpm 12.14.0** no `package.json`.
Para instalar essa versão na máquina, use o [instalador oficial do pnpm](https://pnpm.io/installation):

```bash
npx --yes get-pnpm@0.0.5 12.14.0
```

Feche e abra o terminal depois da instalação e confira `pnpm --version`: deve mostrar `12.14.0`.
Isso vale também para quem já tem uma versão antiga do pnpm: `pnpm self-update` dentro do projeto
altera a versão fixada, mas não atualiza a instalação global antiga.

## Rodar em localhost

Na raiz do projeto:

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

Abra **http://localhost:5173**. O comando baixa os assets ausentes e inicia o servidor com atualização
automática. Na primeira vez, o download precisa de internet e Git. Para encerrar, pressione **Ctrl+C** no terminal.
Se a porta 5173 estiver ocupada, encerre o servidor anterior; a porta permanece fixa para compatibilidade com o Tauri.

O navegador começa com o **look-ahead gratuito**, sem precisar de token, cache ou Rust.
Para jogar manualmente, escolha **You** em **Who plays**. Para testar um modelo, configure as credenciais
em **Setup → Cloudflare → Configure** e selecione Clef-flash ou Clef (27B).

## Ver o app desktop rodando

Na raiz, para abrir a janela desktop em modo de desenvolvimento:

```bash
pnpm run dev:desktop
```

O comando prepara os assets, inicia o Vite e compila/abre o Tauri com recarga automática.
Requer Rust, as ferramentas de compilação C++ do Windows e WebView2. A primeira compilação pode demorar.
Use **Ctrl+C** no terminal para encerrar. Encerre antes qualquer `pnpm run dev`, pois ambos usam a porta 5173.

Se um pnpm antigo falhar com `ERR_PNPM_NO_MATCHING_VERSION` ao buscar `@pnpm/win-x64`,
atualize a instalação da máquina pelo comando em **Preparar o ambiente** e reabra o terminal.
Veja o [diagnóstico da inicialização](docs/08-ui-desktop.md#recuperar-o-pnpm-após-self-update).

Depois de construir uma vez (comandos abaixo), basta dar **duplo clique**:

| Arquivo | O que abre |
|---|---|
| `play.cmd` | O app no modo normal: Clef-flash na seed 6 (replay gratuito se o cache local estiver presente). Troque o jogador no seletor (Clef-flash, Clef 27B, você, referências). **Roda no terminal e mostra os logs do que é mandado ao modelo** a cada decisão (`CCR_LOG=full`, padrão; `brief` ou `off` para mudar); o mesmo texto vai para `runs/logs/play.log` |
| `play-clef.cmd` | O **Clef-flash jogando a seed 6**, com as probabilidades reais no painel e os logs no terminal. Com o cache local completo, **não gasta neurons**; a tecla `M` abre o próximo mapa em cache |

No PowerShell, para abrir direto em outro jogador: `$env:CCR_PLAYER="lookahead"` (gratuito),
`$env:CCR_PLAYER="clef-27b"` (sem mapa em cache) ou um id do benchmark como `clef:clef-flash:view-fx:choice:routing`,
e `$env:CCR_SEED="1"`, antes de `.\play.cmd`.

No desktop, jogo e menus abrem em janelas separadas. O botão no canto superior direito do jogo ou **F2** reabre o painel; **I** abre a inspeção nele. Fechar o painel o oculta; fechar o jogo encerra tudo. Minimizar o jogo pausa até você retomar.

No app: setas ou WASD para você jogar, espaço pausa, `N` dá um passo, `R` repete o mapa, `M` abre outro. O painel mostra, a cada decisão, a ação, a probabilidade
de cada ação, a latência, os tokens e quantos neurons do dia já foram usados.

## Outros comandos

```bash
pnpm install --frozen-lockfile
node scripts/fetch-assets.mjs          # baixa os modelos do Evan (não vão para o git)
pnpm check                            # typecheck, lint e testes

pnpm --filter @ccr/desktop build
cd apps/desktop && pnpm tauri build --no-bundle && cd ../..   # gera o .exe de release (precisa do Rust: rustup)
pnpm run dev:desktop                 # ou: abre o app em modo de desenvolvimento
pnpm bench plan --policies lookahead,always-forward --seeds 1..100
pnpm bench run  --run minha-execucao --policies always-forward,random,lookahead --seeds 1..100
pnpm bench report --run minha-execucao
```

Antes de qualquer execução com modelo, rode `pnpm bench plan`: ele estima os neurons e divide a execução em dias que cabem no free tier.

## Configuração

1. No app desktop ou no navegador de desenvolvimento, abra **Setup → Cloudflare → Configure**, informe **Account ID** (`CF_ACCOUNT_ID`) e **API token** (`CF_API_TOKEN`) e clique em **Save credentials**. O backend salva no `.env` local e aplica sem reiniciar. O jogo fica pausado e salvar não chama a API. Como alternativa, copie `.env.example` para `.env` e preencha os dois campos manualmente (o benchmark também lê esse arquivo).
2. O token deve ter **só** a permissão *Workers AI* e uma data de expiração.
3. O `.env` é ignorado pelo git. Nunca o publique nem o cole em conversas.

Requisitos: Node 24+, pnpm 12.14.0 e Git para o localhost, que pode ser usado em Windows, Linux e macOS.
Para o desktop, instale também os [pré-requisitos do Tauri v2](https://v2.tauri.app/start/prerequisites/)
da sua plataforma; no Windows, Rust, ferramentas C++ e WebView2 (já vem no Windows 11).
O desktop foi verificado no Windows; os outros sistemas ainda precisam de validação da janela nativa.

O GitHub Actions executa a instalação com lockfile congelado, `pnpm check` e o build web em Windows,
Linux e macOS; no Windows, também executa os testes Rust. A CI não precisa de `.env` ou credenciais Cloudflare.

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
