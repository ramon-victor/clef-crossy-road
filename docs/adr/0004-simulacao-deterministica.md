# ADR-0004 · Simulação determinística

- **Status:** aceito · **Data:** 2026-10-14

## Contexto

Comparar modelos exige o mesmo mapa e o mesmo tráfego. O original depende de `Math.random`, da taxa de quadros e de
`setTimeout` (semáforo do trem).

## Decisão

- PRNG com seed (sfc32), único ponto de aleatoriedade.
- Passo fixo de 60 Hz; todo tempo é contado em ticks (o semáforo de 200 ms vira 12 ticks).
- Sem `Date`, `performance`, DOM, Three ou I/O no core.
- Sem alocação no loop quente; linhas em pool.
- Teste: mesma seed + mesmas ações ⇒ mesmo hash de snapshot.

## Consequências

- (+) Reprodutibilidade, benchmark pareado, cache de decisões válido.
- (+) O render interpola entre snapshots e não influencia a lógica.
- (−) Os valores do Evan estão em unidades/frame; a conversão para tiles/s é explícita e testada.
