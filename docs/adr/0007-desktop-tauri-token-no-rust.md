# ADR-0007 · Desktop em Tauri, token no Rust

- **Status:** aceito · **Data:** 2026-10-14 · **Verificado em:** 2026-10-15

## Contexto

O dono do projeto quer algo que pareça um joguinho com a IA jogando, em app desktop. O navegador não deve ver o token.

## Decisão

Tauri v2 com WebView2 (Chromium, já instalado). O webview roda Vite + Three.js + Preact. Um comando Rust `clef_run` injeta o
token e faz o POST; o TS usa uma interface `Transport` com duas implementações (Node para o benchmark, Tauri `invoke` para o app).
Retry, schema, cache e métricas ficam em TS, uma vez.

## Consequências

- (+) Segredo isolado; app leve (sem Electron); o mesmo cliente serve a CLI e o app.
- (−) Exige o Rust (ausente na máquina); só na Fase 3.
- (−) Sem benchmark conhecido de Three.js sob WebView2; medir cedo.

## Atualização (2026-10-14, implementação da Fase 3)

- O Rust (`src-tauri/src`) tem sete comandos: `clef_run`, `cache_get`, `cache_put` e `budget_status` (em `commands.rs`) e, em `launch.rs`, `launch_options` e, só para o autoteste, `selftest_enabled`/`report_selftest`. Todos são registrados em `lib.rs`.
  `clef_run` também **aplica o teto diário** (constante) e **grava o ledger**, para que a interface não consiga gastar além do free tier ([ADR-0008](0008-orcamento-diario-no-free-tier.md)).
- Para desenvolver e testar a interface num navegador comum, existe uma **ponte só de desenvolvimento** (`dev-bridge.ts`, plugin do Vite com
  `apply: "serve"`). Ela é o mesmo contrato do Rust, escuta apenas em `localhost`, recusa outras origens e aplica o mesmo teto. Não entra no build.
  Isso revisa a alternativa "plugin proxy do Vite", descartada como solução de produção abaixo: continua descartada para produção, mas serve para desenvolvimento.
- Verificado no WebView2 real: 180 fps médios, a recusa de orçamento vinda do Rust, o pipeline do Clef pelo cache e um bundle sem credenciais ([08](../08-ui-desktop.md)).
- O autoteste (`CCR_SELFTEST=1`) existe porque a verificação visual por captura de tela copia **tudo** o que está por cima da janela; a captura confiável usa `PrintWindow` na janela do app.

## Atualização (2026-10-15, credenciais configuradas pela interface)

O dono pediu a configuração de `CF_ACCOUNT_ID` e `CF_API_TOKEN` no menu. O formulário em
**Setup → Cloudflare → Configure** recebe valores novos, envia uma vez ao backend e os limpa
ao salvar/fechar. Esta é a exceção explícita à proibição original de passar o token pelo webview:
o usuário pode digitá-lo; **credenciais persistidas nunca são devolvidas**. O status é apenas `{ configured }`.

O Rust oferece `credential_status`/`save_credentials`; a ponte Vite oferece GET/POST `/__ccr/credentials`.
Ambos validam e substituem o `.env` local, preservando as demais configurações. O arquivo salvo tem
precedência sobre o ambiente inicial do app. O formulário mantém o jogo pausado e salvar não chama
a Cloudflare. O armazenamento continua sendo `.env` em texto, não o chaveiro do sistema.

Conta e token são obtidos juntos por chamada; trocar a configuração atualiza o orçamento sem apagar
gastos. Chamadas em andamento mantêm o par e o ledger da conta original. O acesso REST à Cloudflare
continua exclusivo do backend e com o mesmo teto diário.

## Alternativas

- Electron: pesado.
- Plugin proxy do Vite ou servidor Node local: mais peças e não dá aparência de app.
- Navegador puro com o token no cliente: inaceitável.
