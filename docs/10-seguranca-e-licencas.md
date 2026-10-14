# 10 · Segurança e licenças

> **Status:** em vigor desde a Fase 3 · **Verificado em:** 2026-10-14

## Token da Cloudflare

| Regra | Detalhe |
|---|---|
| Onde fica | `.env` (no `.gitignore`) com `CF_API_TOKEN` e `CF_ACCOUNT_ID`. `.env.example` traz só os nomes |
| Quem lê | Só o Node (benchmark, e o plugin de desenvolvimento do Vite) e o Rust (desktop). **Nunca o webview, nunca o bundle** |
| Carregamento | `node --env-file=.env`; no Rust, `dotenvy` procurando o `.env` na raiz do workspace |
| Logs e erros | O token vive numa closure (`@ccr/clef/node`) e em variável local no Rust. Erros carregam só `errors[].message` do serviço; o erro de rede do Rust remove a URL |
| App empacotado | Migrar para o chaveiro do SO (crate `keyring`); não distribuir `.env` |
| Escopo | Só a permissão *Workers AI*, com data de expiração |

**Verificações feitas em 2026-10-14:** o `.env` é o único arquivo do projeto que contém o token ou o ID da conta (busca em todos os
arquivos, ignorando o `.gitignore`); o bundle de produção do app (`apps/desktop/dist`) foi varrido e não contém token, ID de conta nem atribuição de `CF_API_TOKEN`.

**Situação dos tokens:** **dois** tokens passaram pelo chat (o da conta antiga e, depois, o da conta nova que está hoje no `.env`), então ambos devem ser
considerados expostos. O primeiro estava **ativo e sem data de expiração** e não conseguia listar contas nem ler o próprio escopo (403). **Ação recomendada: revogar os dois no
painel da Cloudflare e gerar um novo com permissão só de *Workers AI* e expiração.** Os Account IDs não são segredo, mas também não vão para o git (e não são gravados nos
arquivos do ledger, só uma marca FNV-1a deles).

## Orçamento é uma defesa de segurança também

Gastar acima do free tier é o dano mais provável de um erro (loop, execução esquecida em segundo plano). Por isso o teto diário é
imposto **antes** de cada chamada e em dois lugares independentes: o `ClefClient` (benchmark e UI) e o processo Rust (que usa uma
constante e grava o ledger). Ver [ADR-0008](adr/0008-orcamento-diario-no-free-tier.md). Em 2026-10-14 o projeto gastou ~2,6× o free tier antes de isso existir.

## Tauri

- CSP restritiva em `tauri.conf.json` (o `connect-src` do build de produção só tem `'self'`, `ipc:` e `http://ipc.localhost`): toda chamada à API passa pelo comando Rust. A CSP de desenvolvimento acrescenta o servidor do Vite.
- O comando `clef_run` só aceita os modelos `clef`, `clef-flash` e `clef-omni`, sem URL arbitrária. Isso impede que um webview comprometido use o token contra outros endpoints.
- As capabilities do app são só `core:default`; os comandos próprios (`clef_run`, `cache_get`, `cache_put`, `budget_status`) são registrados em `lib.rs`.
- **Ponte de desenvolvimento no navegador** (`apps/desktop/dev-bridge.ts`): só existe em `vite serve`, escuta apenas em `localhost`,
  recusa requisições de outra origem (proteção contra outra aba chamando `localhost:5173`), aplica o mesmo teto e grava o mesmo ledger. Não faz parte do build.
- Auditar dependências Rust (`cargo audit`) antes de distribuir.

## Licenças

| Item | Licença | Obrigação |
|---|---|---|
| Código do Expo-Crossy-Road | MIT (o README diz que algumas dependências têm outras licenças, como BSD) | Aviso de copyright mantido em `NOTICE` |
| Assets (modelos `.obj`, texturas, áudios, fonte) | O README do Evan declara uso "fair use / educacional" e nenhuma ligação com a Hipster Whale | Ver abaixo |
| Pesos do Clef | Apache 2.0 (Hugging Face) | Só relevante se houver self-host |
| Código deste projeto | A definir; sugestão MIT | |

**Nota sobre IP.** Os modelos e sons replicam o Crossy Road original. O código do Evan é MIT, mas isso **não** estende a licença aos
assets, e a alegação de "fair use" é do próprio autor. Por isso o repositório **não redistribui os assets**: eles são baixados
localmente por `scripts/fetch-assets.mjs` (revisão fixa do repositório do Evan) e ficam no `.gitignore`. **Atenção:** o executável de
release e o `apps/desktop/dist` **embutem** esses assets. Não distribua binários nem o `dist` sem trocar os assets e o nome
(sem usar "Crossy Road" nem a marca da Hipster Whale) e sem revisão de alguém qualificado.
O ícone do app é arte própria, gerada por `scripts/make-icon.mjs`.
