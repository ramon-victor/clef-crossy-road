# ADR-0010 · Palavras, regras nas opções e executor de manobras: níveis de ajuda rotulados

- **Status:** aceito · **Data:** 2026-10-15 · **Complementa** a [ADR-0009](0009-percepcao-memoria-e-julgamento.md)

## Contexto

Depois de 12 condições o Clef-flash ainda jogava como "sempre em frente" (3,7 ruas contra 3,78), embora leitores roteirizados das mesmas vistas fizessem 13 a 19 ruas.
O dono pediu para reescrever a jogabilidade com base nos 13 jogos já controlados pelo Jev (o modelo da TypeSafe; o Clef é o mesmo tipo de modelo e esses
repositórios usam a mesma API de `choice` e `noul`). Lidos em 2026-10-15 (só leitura, nenhum código copiado), eles repetem os mesmos padrões ([11](../11-licoes-dos-jogos-do-jev.md)):

1. **O código compara e o modelo recebe palavras.** As notas do `jev-1.13`, citadas pelo `pong-jev`, dizem que ele é fraco em aritmética, contagem e comparar magnitudes e que detalhe sem relação com a decisão custa precisão. O Pong não manda nenhum dígito (há teste) e traduz tudo em "far below my paddle".
2. **Regra com fronteira explícita nas opções.** No `jev-plays-doom` o texto `rule` (o limite escrito na opção) faz 6,2 abates e o `intent` (só o propósito) faz −0,6: "sem fronteira numérica, o modelo não escolhe ATTACK a partir de um valor bruto". É o que medimos aqui com o estilo `routing`: as opções mudaram o que o modelo escolhe e quase nada o quanto ele lê o estado.
3. **O modelo escolhe a manobra e o código executa e cuida do tempo** (Dino, Tetris, Doom, StarCraft, Minecraft).
4. Resposta velha é descartada ou replanejada; baixa confiança vira abstenção; o modo é rotulado ("observable" × "assisted", "NOT JEV") e nada substitui a escolha do modelo em silêncio.

## Decisão

A ajuda que o código dá ao modelo passa a ter **níveis, todos rotulados** no id da política e em todo relatório (`helpLabel`, coluna "Sees"). Os níveis de antes ficam como controle.

| Nível | O que entra | Id |
|---|---|---|
| controle | os fatos do instante, em qualquer formato | `json` |
| percepção | a tela inteira, onde as coisas estarão em 0,2 s, as últimas jogadas ([ADR-0009](0009-percepcao-memoria-e-julgamento.md)) | `view`, `view-fx`, `json-fx` |
| **palavras** | o mesmo conhecimento, **já comparado pelo código** e dito como a palavra do que ocupa cada casa quando um salto pousa | encoder `lanes` |
| **palavras + regras** | opções que citam os campos e as palavras e dizem quando cada jogada é a certa, iguais para todo estado | `lanes` + manual `rules` |
| **+ executor** | o modelo escolhe a manobra, o código escolhe o instante e dá o salto | `lanes` + `rules` + estratégia `maneuver` |

**Palavras (`lanes`).** Vocabulário fechado (`empty, tree, water, log, lily_pad, vehicle, train, train_coming, outside_world, unseen`), nenhum dígito, e nenhum campo que avalie o que a casa significa para a galinha. Diz o que **está** na casa quando o salto termina (a previsão a 0,2 s da ADR-0009, e a 0,4 s para quem anda de lado antes); não diz se isso é bom. A linha fina fica assim: *o que ocupa a casa* é percepção; *"pode pisar em empty, log e lily_pad"* é **regra do jogo** (está no manual, igual para todo estado, como "a água afoga"); *"avançar é seguro"* continua **julgamento, proibido**. Ao dizer `train_coming` para a luz acesa o vocabulário é deliberadamente conservador (o simulador deixa atravessar com a luz acesa se o trem ainda não chegou; por isso a concordância com o simulador é medida só em água, grama e estrada).

**Regras (`rules`).** O texto das opções nomeia campos e palavras ("Correct when forward.lands_on is empty, log or lily_pad") e diz uma ordem de verificação. Isto **mede se o modelo aplica uma política escrita a palavras**, não se ele a descobre: é obediência a instrução, igual ao `rule` do Doom, e é assim que os relatórios o chamam. Um teste confere que todo campo citado nas opções existe no estado e que o texto não tem "safe", "danger" nem "you should".

**Executor.** O modelo responde `cross_ahead`, `sidestep_left`, `sidestep_right`, `back_off` ou `wait_here`. O código lê o mundo ao vivo a cada passo (0,2 s) com as mesmas palavras: espera a casa ficar pisável e salta; **nunca troca a manobra** do modelo; devolve a decisão com o motivo quando a casa é permanente (árvore), quando a galinha não pode ficar onde está, quando uma plataforma a leva à borda ou depois de 15 passos (3 s) esperando, e o modelo ouve como a anterior terminou (`memory.last_maneuver`). Passos do executor **não são chamadas ao modelo** (0 neurons, `source: "executor"` no registro e no log). O executor decide o instante, que é boa parte da habilidade do jogo, então:
- toda comparação traz as referências grátis **`exec-cross`** (sempre "atravessar" com o mesmo executor, sem modelo: o que o executor faz sozinho), **`exec-rules`** (um escolhedor roteirizado que segue as regras de manobra, o teto) e **`rule-lanes`** (um leitor roteirizado das palavras, por salto);
- se o Clef não passar de `exec-cross` nas mesmas seeds, o relatório diz que o modelo não acrescenta nada.

## Como o benchmark continua honesto

- Cada condição diz seu nível; `json`, `json-fx` e `routing` seguem como controle, com os mesmos caches e hashes de prompt (um teste congela `full` e `minimal`).
- As referências roteirizadas **nunca são modelos**; só dizem se a vista tem informação bastante (`rule-lanes` faz 19,4 ruas e `exec-rules` 15,9, contra 3,78 de `always-forward`, sem gastar nada).
- Resultado negativo também entra em [07](../07-experimentos.md).
- O app só troca o Clef padrão se o portão de partidas de [07](../07-experimentos.md) passar.

## Consequências

- (+) Testa a hipótese que os 13 jogos sugerem: o modelo segue o texto das opções e lê palavras, não aritmética de posição e velocidade.
- (+) Em um jogo em tempo real o executor torna a latência suportável (decide o instante com o mundo ao vivo) e reduz as chamadas.
- (−) O nível "palavras + regras" põe a política no prompt: é um experimento sobre obediência, e o executor põe o instante no código. Por isso os rótulos, as referências e o `exec-cross`.
- (−) `stallLimit` e `maxDecisions` contam passos, inclusive os de espera do executor (a regra é igual para todo mundo).
