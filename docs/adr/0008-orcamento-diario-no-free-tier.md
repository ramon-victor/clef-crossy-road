# ADR-0008 · Orçamento diário no free tier, imposto antes da chamada

- **Status:** aceito · **Data:** 2026-10-14

## Contexto

O dono do projeto definiu uma regra: **não gastar acima do free tier** do Workers AI (10.000 neurons por conta e por dia UTC).
Nesta data o projeto a violou: uma execução do benchmark em segundo plano chegou a ~26.300 neurons (2,6× o limite, ~US$ 0,18
cobrados) porque a única proteção era um limite de chamadas por execução (`--max-calls`), que não conhece o gasto do dia, e porque
o gasto passou do limite sem que nada o impedisse (a conta aceitou as chamadas além do free tier). A falha foi de processo: o número
já tinha passado de 23.000 quando foi notado e a execução seguinte foi iniciada mesmo assim.

## Decisão

1. Um **ledger persistente** de gasto por dia UTC (`runs/cache/spend.ndjson`, uma linha por chamada paga).
2. O `ClefClient` consulta o `SpendBudget` **antes de cada chamada de rede** e a recusa localmente (`ClefError` do tipo `quota`,
   fatal, "Nothing was sent") se o gasto do dia já atingiu o limite. Acertos no cache não custam nada e passam sempre.
3. O teto padrão e máximo é o free tier. O CLI só permite **baixá-lo** (`--daily-neurons`).
4. O app desktop aplica o **mesmo teto no processo Rust**, como constante, e é o Rust que grava o gasto: a interface web não consegue
   gastar mais, nem esquecer de registrar.
5. `pnpm bench plan` estima neurons por política e divide uma execução em dias que cabem no free tier, antes de gastar qualquer coisa.
6. O gasto de hoje foi reconstruído a partir do cache e lançado no ledger, para o limite valer imediatamente.
7. O ledger e o cache toleram uma linha truncada por queda do processo: terminam a linha parcial antes de acrescentar, senão o
   novo registro ficaria ilegível e o gasto seria **subcontado**.

## Atualização: o ledger é por conta (2026-10-14)

A cota gratuita é **por conta Cloudflare**. Quando o dono passou a usar outra conta, o ledger único passou a mostrar 26.347 de 10.000 e teria
bloqueado uma conta que não gastou nada (e, no sentido inverso, um ledger sem conta esconderia o gasto de uma conta antiga). Decisão:

- Cada entrada leva a marca da conta (`account`): **FNV-1a de 64 bits do ID da conta**, em hex. O ID não é gravado nos arquivos. O TypeScript (`accountTag`) e o Rust (`account_tag`) calculam o mesmo valor e são testados com os mesmos vetores de teste.
- O gasto do dia é somado **só para a conta atual** (`CF_ACCOUNT_ID`). Uma entrada **sem marca conta para toda conta**, e sem conta conhecida todas as entradas contam: registros antigos ou incompletos só podem deixar a guarda mais estrita, nunca mais frouxa.
- O lançamento antigo (26.347, conta `0ba9…`) foi marcado com a marca da conta antiga por uma migração única (com backup). Se o dono voltar a ela hoje, continua bloqueada.
- Trocar de conta para ter mais cota é uma decisão do dono. O código só impede que um engano gaste além do free tier **de cada conta**; o painel da Cloudflare segue sendo a fonte final do gasto real (o ledger só vê o que este projeto enviou, e não sabe se a conta já tinha uso).

## Consequências

- (+) Exceder o free tier por engano passa a ser impossível pela CLI e pelo app; uma violação exigiria editar o código.
- (+) O gasto é auditável (arquivo de texto) e o custo de uma execução é conhecido antes dela.
- (−) O ledger é local: outro processo ou máquina usando a mesma conta não o vê. O gasto da conta no painel da Cloudflare continua sendo a fonte final.
- (−) Há uma folga pequena e limitada: chamadas já em voo quando o limite é cruzado ainda são cobradas (no máximo a concorrência do cliente).
- Scripts avulsos que chamam a API direto ignoram o ledger: a regra no `AGENTS.md` os proíbe.
