# Team: prompt libero contro protocollo CRM (pilota)

Data 2026-11-02. Modello `sonnet`. Protocollo: callout di chiusura `STATO: FATTO | DEVIAZIONE | BLOCCATO | DISACCORDO` in ogni prompt di compito (`pi-team/src/crm.ts`). Controllo: stesso team con `PI_TEAM_CRM=0`.

## Metodo
- Casi `tc01`, `tc02`, `tc03` di `team-cases.mjs` (bugfix multiplo, modulo nuovo, refactoring), fixture pulita per ogni run.
- Un solo giro per braccio, in sequenza (`--concurrency 1`). Dati: `results/team-crm-r1.jsonl`, log in `logs/team-crm-r1/`.
- Analisi: `node team-crm-analyze.mjs results/team-crm-r1.jsonl`.

## Risultati

| Braccio | Run | Pass | Team verificato | Retry | Bloccati | Deviazioni | Tempo med. | Output med. | Input med. | Errori |
|---|---|---|---|---|---|---|---|---|---|---|
| CRM (callout) | 3 | 3/3 | 3/3 | 0 | 0 | 0 | 91,7 s | 4294 | 184004 | 0 |
| libero (controllo) | 3 | 3/3 | 3/3 | 0 | 0 | 0 | 60,1 s | 4577 | 166593 | 0 |

Per caso (CRM / libero): tc01 91,7 s · 6211 out / 53,1 s · 4577 out; tc02 62,8 s · 3739 out / 85,3 s · 4648 out; tc03 110 s · 4294 out / 60,1 s · 3059 out.

Sessione principale (output token): tc01 3336 / 1552, tc02 1037 / 1036, tc03 1541 / 1259.

## Lettura
- Qualità: pari. 3/3 in entrambi i bracci, nessun retry, nessun blocco, nessuna deviazione. Il pilota **non** mostra alcun vantaggio del protocollo, né svantaggio di correttezza.
- Gli agenti CRM emettono davvero il callout (`STATO:` presente nei log di tutti e 3 i run CRM, assente nel controllo).
- Costo: nel braccio CRM l'input mediano è +10% (184k contro 167k) e il tempo mediano +53% (92 s contro 60 s). Con n=3 non distinguo il segnale dal rumore: tc02 va nel verso opposto (62,8 contro 85,3 s). Il +21 s mediano resta una pista, non un fatto.
- Il costo fisso del blocco è noto: poche righe per prompt di compito.

## Limiti
- n=1 per cella: nessuna significatività.
- I tre casi sono facili: il team li risolve senza mai dire `BLOCCATO` o `DISACCORDO`, quindi il ramo che il protocollo dovrebbe migliorare non è stato esercitato.
- La sessione principale usa il tool `team`: la differenza di output in tc01 (3336 contro 1552) può venire dalla pianificazione, non dal protocollo.

## Prossimi passi
- Aggiungere un caso con compito impossibile o sbagliato (file inesistente, requisito contraddittorio) per esercitare `BLOCCATO`/`DISACCORDO`: lì il controllo dovrebbe sprecare retry.
- Almeno 3 giri per braccio prima di citare tempi o token.
- Non attivare la regola delle 2 sfide finché non c'è un caso che la giustifichi.

## Piano fisso (tc01, 2 implementer + reviewer, senza sessione principale)
Script: `team-crm-fixed.mjs`, riepilogo `team-crm-fixed-summary.mjs`, dati `results/team-crm-{fixed-r1,v2..v8}.jsonl`, tracce `*.trace.json`. Tutti i run passano il controllo.

| Versione CRM | Input | Richieste | Tempo |
|---|---|---|---|
| v1 additiva | +20% | +17% | +15% |
| v2 istruzioni sostitutive, reviewer a 1 chiamata (n=3) | −17% | −23% | −22% |
| v3 + diff consegnato al reviewer (n=3) | −30% | −33% | mediana −3%, media +16% |
| v4-v7 + briefing dei file nel prompt / "una sola bash" / "edit mirati" | −36%…−3% | −46%…−23% | +20%…+131% (stalli di 80-220 s) |
| v8 = v3 rimisurata (n=4) | mediana −16%, media +1% | mediana −23% | mediana +28%, media +82% |

Esito: l'obiettivo −30% su token e velocità NON è raggiunto in modo stabile. Il −30% di input compare nei run senza stalli; in ~5 run CRM su 16 un implementer stalla 80-220 s (tool call multiple o scritture lunghe, errori "Tool call … was not expected by Pi" del bridge). Il braccio libero non ha mai stallato in ~20 run. Causa dello stallo non dimostrata. Il briefing nel prompt è stato misurato e peggiora il tempo: non usato.
