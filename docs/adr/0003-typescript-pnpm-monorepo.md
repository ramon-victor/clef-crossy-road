# ADR-0003 · TypeScript + pnpm workspaces

- **Status:** aceito · **Data:** 2026-10-14

## Contexto

O projeto tem um núcleo, um cliente de API, agentes, um renderer e dois apps (CLI e desktop). O repo do Evan já é TypeScript (~5.9) com Three r182.

## Decisão

TypeScript estrito em ESM, monorepo com **pnpm workspaces**, Vitest e Biome. Node 24 e pnpm 10 já estão instalados.
Os pacotes são consumidos como código-fonte TS (`exports` aponta para `src/index.ts`), sem etapa de build; imports usam a extensão `.ts` e só sintaxe TypeScript apagável (`erasableSyntaxOnly`), para o Node 24 executar os arquivos direto.

A direção das dependências é imposta pelo **layout estrito do `node_modules` do pnpm**: um pacote só consegue importar o que declara no `package.json`. Cada pacote tem seu próprio `typecheck`. (A ideia inicial de *TS project references* foi trocada por isso: sem emissão de arquivos, as references acrescentam configuração e não impõem nada além do que o pnpm já impõe.) O core ainda ganha uma camada extra: o `tsconfig` dele não carrega tipos de DOM nem de Node, e um teste de pureza varre o código.

Versões fixadas em 2026-10-14: TypeScript 7.0.2, Vitest 5.0.4, Biome 2.5.15.

## Consequências

- (+) Um idioma para core, cliente, UI e CLI; sem build intermediário.
- (+) A fronteira entre pacotes é verificada pelo gerenciador de pacotes e o determinismo do core por teste.
- (−) Importar `.ts` com extensão exige `allowImportingTsExtensions`; ferramentas de empacotamento (Vite) precisam aceitá-lo, o que já fazem.
- (−) O Tauri adiciona Rust, mas isolado no comando `clef_run`.

## Alternativas

- Turborepo/Nx: exagero para poucos pacotes.
- bun: o lockfile do Evan é bun, mas pnpm é mais previsível no Windows.
