# ADR-0001 · Núcleo headless + port das regras do Evan

- **Status:** aceito · **Data:** 2026-10-14

## Contexto

O Expo-Crossy-Road tem a lógica acoplada ao Three.js (linhas são `Group`, colisão lê `mesh.position`), usa
`Math.random` sem seed e move os carros por frame ignorando `dt`. Dá para jogá-lo, mas não para comparar modelos no mesmo
mapa, nem rodar milhares de partidas sem GPU.

## Decisão

Criar `@ccr/core`: simulação em TypeScript puro, sem dependências, que **porta as regras** do Evan (grama, rua, trilho, água,
toras, trem). Reaproveitar dele os assets e o visual no renderer. O código dele é referência somente leitura.

## Consequências

- (+) Seeds reproduzíveis, benchmark sem janela, testes rápidos, ambiente de RL.
- (+) O renderer fica trocável e pequeno.
- (−) É preciso portar e testar as regras; risco de infidelidade (mitigado por testes dourados).
- (−) Diverge do código original, então a atribuição MIT vai em `NOTICE`.

## Alternativas

- Fork do Expo e remendos in loco: mais rápido de ver na tela, mas não roda headless e é difícil de testar.
- `SepraDC/crossy-js`: 1 commit, 0 estrelas, sem trens, licença ambígua, e não é o jogo do Evan.
