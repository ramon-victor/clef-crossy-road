# 09 · Roadmap

> **Status:** Fases 0 a 3 concluídas; Fase 4 concluída na parte que não gasta API; **uma 13ª condição (palavras, regras, perguntas pequenas e executor) supera `always-forward` em 40 seeds, e o portão de 100 seeds é o próximo passo** · **Verificado em:** 2026-10-15

A ordem é guiada pelo risco: primeiro descobrir se o modelo consegue jogar, depois investir em visual.

| Fase | Entrega | Critério de saída | Estado |
|---|---|---|---|
| 0 | Docs, `AGENTS.md`, `.env`, primeiro teste do Clef | Contrato confirmado, latência medida, sonda registrada | **Concluída** ([00](00-viabilidade.md)) |
| 1 | `@ccr/core` com as regras portadas | Mesma seed + mesmas ações ⇒ snapshot idêntico; testes; perguntas abertas de [04](04-game-core.md) resolvidas | **Concluída**: 60 testes. Os "testes dourados" são de propriedades (faixas, probabilidades, regras), porque o original usa `Math.random` sem seed |
| 2 | `@ccr/clef`, `@ccr/agent`, `apps/bench`; gate | **Gate** de [07](07-experimentos.md) avaliado, com plano B se falhar | **Concluída, gate NÃO passou** em 9 condições (JSON, grade, imagem, `critic-go`, manual mínimo, Clef 27B, JSON com colunas relativas). Plano B executado e diagnosticado (AUC) |
| 3 | Rust, `apps/desktop`, `@ccr/render`, painel, modo humano | 60 fps; token ausente do webview | **Concluída**: 180 fps médios no WebView2; bundle sem token; exe de release de 8,4 MB ([08](08-ui-desktop.md)) |
| 4 | Matriz de modelos; visão (E2); latência injetada; relatório com IC | Relatório com IC de 95% | **Concluída, exceto o `clef-omni`**: Clef-flash e Clef 27B, imagem, latência injetada (serial e pipelined), `plan`, `diagnose` e relatórios com IC. Resultado negativo para todos os modelos |
| 5 | Opcional: trajetórias para RL fine-tuning; Jev | — | **Parte offline concluída**: `pnpm bench export` gera trajetórias (observação, ação, recompensa, fim) a partir das partidas gravadas, só com fatos físicos na observação (10.625 passos do look-ahead com ≥ 20 ruas, 17 MB). O treino em si depende do programa de RL da Cloudflare ou de hospedar os pesos; o Jev não foi avaliado |

## Próximos passos

0. **Rodar a condição do app em 100 seeds** (`clef:clef-flash:scene:route:lookup`, [ADR-0011](adr/0011-controlador-com-rota-e-tres-consultas.md)): são ~6 neurons por pedido e de 20 a 70 pedidos por partida, então ~25.000 a 30.000 neurons: **três dias com duas contas**, `bench plan` antes de cada passo e, por segurança, um **teto de chamadas por partida** (`--max-calls` só impede *iniciar* partidas). Isso também enche o cache do app (hoje só as seeds 6 a 8 reproduzem; conferir cada seed com `--daily-neurons 0`). Depois: o 27B nas mesmas seeds só se couber, e comparar sempre com `exec-route`.

O experimento zero-shot está respondido: **nenhum modelo testado supera "sempre em frente"** ([07](07-experimentos.md)). O que sobra é escolher o que fazer com esse resultado:

1. **Fase 5, o caminho natural:** fine-tuning por RL usando o núcleo como ambiente (ver [ADR-0006](adr/0006-sem-fine-tuning-nem-self-host.md)). O diagnóstico aponta o alvo: aprender a ler posição e velocidade para acertar toras e lírios, que é onde 72% a 85% dos saltos para a água morrem. Depende do programa de RL da Cloudflare (ainda com apoio de equipe) ou de hospedar os pesos abertos (Apache 2.0).
2. **Barato e opcional:** `clef-omni` com imagem em 25 a 40 seeds (cerca de 80 neurons por seed, então ~2.000 a 3.200), para fechar a matriz de modelos. Esperar que fique em "sempre em frente" ou pior.
3. **Experimentos de estratégia** (nossa regra por cima do modelo): vetar saltos quando P(avançar) cair abaixo de um limiar. Só deve ajudar a *parar na beira* da água, não a atravessá-la. Já testado do lado da entrada: colunas relativas à galinha (`json-rel`, 40 seeds), a tela inteira, o mundo daqui a 0,2 s e a memória das últimas jogadas (`view`, `view-fx`, `json-fx`; 100 partidas: 3,73 ruas, igual a "sempre em frente"), e o Clef 27B com essa vista (melhor nas sondas, mas igual nas 8 partidas); a imagem no Clef-omni também não muda ([07](07-experimentos.md)). Os leitores roteirizados fazem 13 a 19 ruas com as mesmas vistas, então **a informação está na vista e o modelo não a usa**. Reescrever as opções para dizerem *quando* cada jogada serve (estilo `routing`) trocou o "sempre frente" por "quase sempre esperar ou ir à esquerda" (a AUC seguiu em 0,56 a 0,63): o modelo escolhe pelo significado das palavras das opções, não pelo que está na coluna da galinha. "Alcançável", "seguro" e tempo-até-colisão seguem proibidos ([ADR-0009](adr/0009-percepcao-memoria-e-julgamento.md)).
4. Rodar `pnpm bench plan` antes de qualquer execução com modelo, sempre ([ADR-0008](adr/0008-orcamento-diario-no-free-tier.md)).
5. Primeiro commit e CI local (`typecheck`, `lint`, `test`), quando o dono quiser.
6. **Revogar os dois tokens** que passaram pelo chat e gerar um com escopo mínimo e expiração ([10](10-seguranca-e-licencas.md)).

## Decisões que ficam para depois

- Instalador do app (NSIS) e chaveiro do SO para o token.
- Conversão dos assets para GLB, se o carregamento pesar (hoje não pesa: 88 draw calls, 180 fps).
- Distribuição: exige trocar os assets e o nome ([10](10-seguranca-e-licencas.md)).
- Skills e subagentes de projeto em `.claude/` (ex.: "rodar benchmark", "portar regra do Evan"), quando houver tarefas repetidas.
