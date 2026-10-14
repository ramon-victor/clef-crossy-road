# ADR-0007 · Desktop em Tauri, token no Rust

- **Status:** aceito · **Data:** 2026-10-14

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

- O Rust (`src-tauri/src/lib.rs`) tem cinco comandos: `clef_run`, `cache_get`, `cache_put`, `budget_status` e, só para o autoteste, `selftest_enabled`/`report_selftest`.
  `clef_run` também **aplica o teto diário** (constante) e **grava o ledger**, para que a interface não consiga gastar além do free tier ([ADR-0008](0008-orcamento-diario-no-free-tier.md)).
- Para desenvolver e testar a interface num navegador comum, existe uma **ponte só de desenvolvimento** (`dev-bridge.ts`, plugin do Vite com
  `apply: "serve"`). Ela é o mesmo contrato do Rust, escuta apenas em `localhost`, recusa outras origens e aplica o mesmo teto. Não entra no build.
  Isso revisa a alternativa "plugin proxy do Vite", descartada como solução de produção abaixo: continua descartada para produção, mas serve para desenvolvimento.
- Verificado no WebView2 real: 180 fps médios, a recusa de orçamento vinda do Rust, o pipeline do Clef pelo cache e um bundle sem credenciais ([08](../08-ui-desktop.md)).
- O autoteste (`CCR_SELFTEST=1`) existe porque a verificação visual por captura de tela copia **tudo** o que está por cima da janela; a captura confiável usa `PrintWindow` na janela do app.

## Alternativas

- Electron: pesado.
- Plugin proxy do Vite ou servidor Node local: mais peças e não dá aparência de app.
- Navegador puro com o token no cliente: inaceitável.
