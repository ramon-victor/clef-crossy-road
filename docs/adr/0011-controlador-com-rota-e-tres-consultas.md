# ADR-0011 · Controlador com rota, vista de cena e três consultas: o nível "assistido na navegação"

- **Status:** aceito · **Data:** 2026-10-15 · **Complementa** a [ADR-0010](0010-palavras-regras-e-executor-de-manobras.md)

## Contexto

A condição da ADR-0010 (`graph-maneuver`) fazia 10,05 ruas em 40 partidas, mas **58% das partidas estagnavam**. Lendo os 40 jogos gravados e o simulador (de graça, nada gravado):

- Em quase toda partida estagnada o final é **uma só manobra repetida 30 a 40 vezes** (`wait_here` ×37 a ×40 em 13 jogos; `sidestep_*` recusado e escolhido de novo).
- Em **26%** das 1.828 decisões o escolhedor ideal mandava `cross_ahead` e o modelo escolhia `wait_here`. P(avançar) era 42% com `lily_pad` à frente e 45% com `log` (contra 76–84% com `empty`): a regra da pergunta era composta (duas condições) e o modelo não a aplicava.
- Das 23 partidas estagnadas, 10 tinham saída que a vista já mostrava, 6 precisavam de 2 ou mais passos de lado e 7 estavam **cercadas por árvores**: a saída é "voltar uma linha, deslizar, avançar duas vezes", que nenhuma manobra de um passo faz.
- Os 13 jogos do Jev ([11](../11-licoes-dos-jogos-do-jev.md)) deixam o **caminho** para o código (Doom `nextWaypoint`, Tetris, Minecraft, StarCraft): o modelo escolhe o destino ou o lado, o código acha a rota.

## Decisão

Um novo nível de ajuda, rotulado `words + rules + graph + route executor` (`helpLabel`) e mostrado em todo relatório:

| Peça | O que é | Onde |
|---|---|---|
| **Vista `scene`** | As palavras do `lanes`/`moves` ampliadas para a linha toda: para cada lado, quão longe está a abertura mais próxima da linha da frente (`adjacent`, `two_away`, `three_or_more`, `none`), quantas casas da própria linha dá para pisar (`blocked_at_once`, `free_for_one`, `free_for_two_or_more`), se a galinha está atrás da linha mais longe já alcançada (`behind_frontier`), e se o controlador já devolveu aquele desvio (`recently_failed`). Vocabulário fechado, sem dígitos, **sem "alcançável" nem "seguro"**: diz o que há onde. | `scene.ts` |
| **Manual `lookup`** | **Três perguntas de uma consulta cada**, com **exemplos resolvidos**: `cell` (dá para pisar na casa da frente?), `moving` (as coisas dessa linha se movem?) e `around` (de que lado contornar?). Uma regra de dois campos foi lida como um só (a água parada saiu como "passando" em 12 de 12 estados), então cada pergunta lê um campo. | `route-prompts.ts` |
| **Roteamento** | O único código nosso sobre as respostas: casa pisável, ou coisas que continuam passando, é `cross_ahead`; casa não pisável e nada se move é "fechado", e a terceira resposta decide (esquerda, direita ou esperar). | `route-policy.ts` |
| **Controlador de desvio** | `cross_ahead` espera a brecha e salta; `detour_left`/`detour_right` **caminham a rota** (voltam uma linha se for preciso, deslizam, avançam até uma linha ainda não alcançada), por busca em largura sobre as mesmas palavras (profundidade 8), refeita a cada 0,2 s com o mundo ao vivo, cada salto conferido **na janela do próprio salto** (veículo conta desde 0,05 s dentro do salto que traz a galinha à linha; água e trilho só no pouso), com deriva em toras e margem da borda. **Nunca troca o lado que o modelo escolheu**; devolve a decisão com o motivo (sem rota, 12 saltos, 15 passos de espera, plataforma levando à borda). Uma manobra recusada deixa a galinha em **retenção segura** (espera onde é seguro; se a casa não aguenta, uma busca de até 4 saltos acha onde ficar), para a recusa nunca ser o que a mata. | `route.ts` |

O controlador planeja a rota e o código escolhe o instante: **o modelo só escolhe entre atravessar, contornar por um lado ou esperar**. Por isso:

- o relatório traz o piso `exec-cross` (só o executor de antes) e o teto `exec-route` (o escolhedor ideal das regras com este controlador, sem modelo), para dizer quanto do placar é do controlador e quanto é do modelo;
- a **concordância com o escolhedor ideal** (`bench probe-report`) mede obediência às regras, não habilidade;
- o `DEFAULT_CLEF` do app e do bench (o id curto `clef`) passa a ser esta condição; as doze primeiras ficam como controle e abrem no app como `Custom`.

## O que a medição mostrou

Números em [07](../07-experimentos.md).

- **Grátis:** com este controlador o escolhedor ideal (`exec-route`) faz **48,3 ruas** em 100 seeds (mediana 38), sem afogar (0%); mortes por carro 17%, borda 7%; 59% terminam estagnadas (agora em ruas altas, em becos sem saída que nem o `lookahead` resolveria), 15% chegam ao teto de 300 decisões. Sem a rota (`exec-rules`): 18,8 ruas.
- **Sonda de 90 estados** (Clef-flash): o modelo concorda com o escolhedor ideal em **94%** dos estados (as condições de palavras anteriores: 40 a 66%). Com duas perguntas em vez de três foram 86%, e com a palavra `no` no lugar de `still` na água parada, 85%.
- **Partidas** (7 seeds): **22,4 ruas** contra 4,4 da condição anterior nas mesmas seeds e 2,7 de "sempre em frente" (Δ +19,7 [8,1, 33,0]); 2 de 7 estagnadas (antes 58%).

## Consequências

- (+) Estagnação e laços saem do modelo e vão para onde o código é bom (caminho); o modelo faz as consultas que mostrou saber fazer.
- (−) É o nível de **mais ajuda** até aqui: a política (regras), o roteamento, o caminho e o instante são nossos. O resultado é do conjunto, e é assim que os relatórios o chamam. Se o Clef não passar de `exec-route` nas mesmas seeds, o relatório diz que o modelo não acrescenta nada.
- (−) **A reprodução do cache depende do controlador.** Os pedidos ao modelo são os mesmos, mas a trajetória do jogo depende do que o controlador faz; mudar `route.ts` (ou os textos) faz o mapa em cache divergir e gastar. Regra: depois de mexer, jogar as seeds de novo e **conferir cada uma com `--daily-neurons 0`** (qualquer pedido novo é recusado, nada é gasto) antes de listá-las no app. Esta regra nasceu de um erro: o app abriu na seed 2, jogada com uma versão anterior do controlador, e gastou 49 neurons.
- (−) `--max-calls` do `bench run` só **para de iniciar** partidas: uma partida em andamento continua. Uma rodada de 5 partidas planejada para ~900 neurons gastou 1.380 e só parou no teto diário local.

## Adendo (2026-10-17): uma quarta consulta no tronco e a manobra de sair da plataforma

- **`ride`**, enviada **só** quando a galinha está numa plataforma (nos outros estados o pedido é o de antes, palavra por palavra, e o cache vale): "`chicken.edge_in` é `a_moment`?", uma consulta de um campo, com exemplos resolvidos. As opções são `leaving` e `staying`. **A redação decidiu**: perguntando em palavras se a plataforma "está para levá-la para fora do mundo", o modelo respondeu `leaving` em 3 de 12 estados a um instante da borda e em nenhum dos outros 12 (com o motivo e mais exemplos, 0 de 12); perguntando se a palavra é `a_moment`, **12 de 12 e 0 de 12** ([07](../07-experimentos.md)).
- **Roteamento:** `leaving` vira a manobra `leave_platform`, com prioridade sobre as outras respostas; o controlador acha a saída (para a frente, depois de lado, depois para trás, até um lugar onde nada a leva à borda em 2,5 s) e a caminha como um desvio, recusando com o motivo se não houver (`no way off within 8 hops`). O escolhedor ideal (`routeChoice`) faz o mesmo com `edge_in`. As barras de probabilidade gravadas seguem conjuntas, com a massa de `leaving` na primeira jogada da saída.
- **A rede de segurança continua**: uma plataforma que leva à borda em menos de um segundo ainda faz o controlador recusar a travessia e sair; se o modelo errar `ride`, ela age, marcada como passo do controlador (`hold`/`edge`), nunca como a escolha do modelo.
- **O que não rendeu** (medido sem modelo, [07](../07-experimentos.md)): sair da plataforma pela saída mais curta (voltar) fazia a galinha embarcar no mesmo tronco de novo (48,7 → 42,1 ruas); sair já com a borda a 2,5 s custava 1,6 rua (48,3 → 46,7), e "não embarcar num tronco que sai antes de ela poder seguir" tira as mortes na borda (11 → 3, 1, 0, conforme o limiar) mas custa 9 a 23 ruas, porque a galinha passa a esperar na margem. A decisão fatal do caso da seed 6 é **embarcar**, e nenhum limiar testado a evita sem estagnar.
- **Passos do controlador** (`RouteStep`) passam a dizer o motivo: `wait` é `gap` (a casa não está livre) ou `no_rest` (a casa está livre para o salto, mas um veículo ou trem a alcançaria antes de a galinha poder seguir) e nomeia o que a alcança; `hold` é `refused`, `unsafe_here`, `edge` ou `no_way`; `leave` é novo. A tela os mostra ([08](../08-ui-desktop.md)).
- **Um erro do controlador achado no caminho:** saindo de um tronco a galinha está numa coluna fracionária e o salto à frente a leva à coluna inteira passando pela fileira de estrada antes de chegar; a janela conferia só a coluna de destino (`hopWindow` confere as duas): 19 → 15 mortes por carro, 47,5 → 48,7 ruas no `exec-route`.
