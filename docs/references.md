# Referências

> **Verificado em:** 2026-10-14. Fontes oficiais primeiro; fontes independentes marcadas.

## Cloudflare: Clef

| Fonte | Usada para |
|---|---|
| [clef-flash (modelo)](https://developers.cloudflare.com/workers-ai/models/clef-flash/) | Schema de request/resposta, limites (24.576 tokens de contexto, 64 perguntas, 4 imagens), preço |
| [clef (modelo)](https://developers.cloudflare.com/workers-ai/models/clef/) | Comparação com o modelo maior |
| [Changelog: lançamento do Clef (2026-10-01)](https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/) | Modelos, endpoints, tipos de pergunta, latências de lançamento |
| [Changelog do Workers AI](https://developers.cloudflare.com/changelog/product/workers-ai/) | Entrada de 2026-10-09: Clef-omni, corte de preço do Clef-flash, contexto 64K → 24K, Clef até 2x mais rápido |
| [Blog: Introducing Clef](https://blog.cloudflare.com/clef-decision-models) | Casos de uso, benchmarks da Cloudflare, método de treino, plataforma de RL |
| [Preços do Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/) | US$ 0,038/M tokens e 3.455 neurons/M tokens (Clef-flash); free tier de 10.000 neurons/dia |
| [Limites do Workers AI](https://developers.cloudflare.com/workers-ai/platform/limits/) | Rate limits por categoria (o Clef não aparece listado) |

## Fontes independentes (amostras pequenas)

| Fonte | Usada para |
|---|---|
| [Hands-on com o Clef (DEV)](https://dev.to/akari_iku/hands-on-with-cloudflares-decision-model-clef-on-workers-ai-del) | Forma real da resposta, `instructions` obrigatório, ordenação de chaves e IDs, 166 ms medidos do Japão, limitações. ~15 requests, ~5 casos por experimento |
| [Tutorial do Jev sobre o Clef](https://thejevai.com/blog/how-to-use-cloudflare-clef) | Envelope `result` no REST, `noul` como objeto. Não descreve como acessar o Jev |

## Outros jogos controlados pelo Jev (lidos em 2026-10-15; padrões em [11](11-licoes-dos-jogos-do-jev.md))

| Repositório | Jogo |
|---|---|
| [lukaske/jev-doom-agent](https://github.com/lukaske/jev-doom-agent), [olivier-motium/jev-doom](https://github.com/olivier-motium/jev-doom), [tirukovelamanoj/jev-plays-doom](https://github.com/tirukovelamanoj/jev-plays-doom) | Doom |
| [fhshaik/typesafe-mario](https://github.com/fhshaik/typesafe-mario) | Super Mario Bros. |
| [pedroarruda07/jev-plays-tetris](https://github.com/pedroarruda07/jev-plays-tetris) | Tetris |
| [phyous/tsai-sc](https://github.com/phyous/tsai-sc) | StarCraft |
| [anxkhn/JevPlaysPokemon](https://github.com/anxkhn/JevPlaysPokemon) | Pokémon FireRed |
| [phyous/tsai-civ2](https://github.com/phyous/tsai-civ2) | Civilization II |
| [Hardel-DW/jev.mods](https://github.com/Hardel-DW/jev.mods) | Minecraft |
| [safzanpirani/pong-jev](https://github.com/safzanpirani/pong-jev) | Pong |
| [tanayvasishtha/Slither-Me-Jev](https://github.com/tanayvasishtha/Slither-Me-Jev) | Snake |
| [skpanigrahy/jev-t-rex-runner](https://github.com/skpanigrahy/jev-t-rex-runner) | Chrome Dino |
| [shantanugoel/jev-games](https://github.com/shantanugoel/jev-games) | Mario, Kung Fu e Doom |

São estudos de terceiros, de qualidade desigual; usados só como padrão, sem copiar código.

## Jogo

| Fonte | Usada para |
|---|---|
| [EvanBacon/Expo-Crossy-Road](https://github.com/EvanBacon/Expo-Crossy-Road) | Código-fonte lido em `src/CrossyGame.ts`, `GameEngine.ts`, `CrossyPlayer.ts`, `Row/Road.ts`, `Row/Water.ts`, `Row/RailRoad.ts`, `package.json`. Licença MIT; README alega fair use educacional para os assets |
| [SepraDC/crossy-js](https://github.com/SepraDC/crossy-js) | Alternativa avaliada e descartada: 1 commit, 0 estrelas, sem trens, LICENSE não detectado pelo GitHub |

## Agentes e documentação para agentes

| Fonte | Usada para |
|---|---|
| [agents.md](https://agents.md/) | Formato, seções sugeridas, `AGENTS.md` aninhados (o mais próximo vence) |
| [Evaluating AGENTS.md (ETH Zurich, arXiv 2602.11988)](https://arxiv.org/pdf/2602.11988) | Arquivos de contexto elevam custo e passos; os gerados por LLM pioram um pouco o resultado, os escritos à mão ajudam pouco. Conclusão aplicada: só o que não é inferível do código |
| [Claude Code: memória e CLAUDE.md](https://code.claude.com/docs/en/memory) | O Claude Code lê `CLAUDE.md`, não `AGENTS.md`; usar `@AGENTS.md` como import. As duas versões da página divergem sobre o `/init` ler `AGENTS.md` |

## Tauri

| Fonte | Usada para |
|---|---|
| [Tauri v2: pré-requisitos](https://v2.tauri.app/start/prerequisites/) | Rust, MSVC e WebView2 no Windows |
| [Tauri v2: HTTP client](https://v2.tauri.app/features/http-client/) | O plugin reexporta `reqwest` para uso no Rust |

## Não verificado

- Como acessar o Jev (endpoint, chave, preço): não encontrado.
- Rate limit específico do Clef.
- Desempenho de Three.js sob WebView2: nenhum benchmark encontrado.
