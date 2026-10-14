# 01 · Visão e escopo

> **Status:** rascunho · **Verificado em:** 2026-10-14

## Visão

Um joguinho de desktop em que se assiste ao **Clef-flash** jogar Crossy Road, com um painel que torna a decisão
visível: qual ação, com que probabilidade, em quanto tempo. O mesmo ambiente roda sem janela para comparar modelos
com rigor.

## Objetivos

1. **Experimento sério:** medir quão bem modelos de decisão da Cloudflare jogam, com seeds iguais, baselines e
   intervalos de confiança.
2. **Demo agradável:** app desktop com visual e sons do jogo do Evan, painel da IA, modo humano e controles de velocidade.
3. **Base reaproveitável:** o núcleo determinístico vira ambiente de RL, caso se queira fine-tuning no futuro.

## Não-objetivos (por ora)

- Publicar na Cloudflare, ou qualquer deploy público.
- Fine-tuning ou auto-hospedar os pesos ([ADR-0006](adr/0006-sem-fine-tuning-nem-self-host.md)).
- Mobile, multiplayer, loja, personagens desbloqueáveis, anúncios.
- Competir com agentes de RL treinados do zero.
- Dar ao modelo qualquer ajuda de segurança da jogada ([ADR-0005](adr/0005-regra-de-justica-da-observacao.md)).

## Métricas de sucesso

| Métrica | Definição | Meta |
|---|---|---|
| Ruas atravessadas | Maior linha à frente alcançada (definição exata a confirmar na Fase 1) | Reportar média, mediana e IC de 95% |
| Gate da Fase 2 | Diferença pareada de ruas contra *AlwaysForward* e *Random*, mesmas seeds | IC de 95% da diferença acima de zero |
| Causa da morte | Carro, água, trem | Distribuição por política |
| Movimentos inválidos | Tentativas contra árvore ou limite | Taxa por decisão |
| Latência | p50 e p95 de ida e volta | Medir; sem meta prévia |
| Custo | Tokens e US$ por partida | Medir; teto diário no free tier de 10.000 neurons |
| Desempenho do app | FPS no WebView2 | 60 fps |

Nenhuma meta de pontuação é fixada antes de medir: seria chute.
