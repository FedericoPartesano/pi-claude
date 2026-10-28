# google-gemini/gemini-cli

## Source Register
| Campo | Valore |
|---|---|
| Repository | https://github.com/google-gemini/gemini-cli |
| Commit | cd1b45c2db0a5ea7b7fc3b67c1ba5879601d6005 (main, 2026-10-26) |
| Letto il | 2026-10-26 |
| Canale | `gh api` (1 file + elenco) |
| Licenza | Apache-2.0 — copiabile: sì |
| Dimensione | 104 MB |

## Salute
Push 2026-10-26; 108.403★; 787 issue aperte; primo contributore 391 su ~1k (basso accentramento).

## Architettura — fatti dal codice
- Contesto come **pipeline di processori** (`packages/core/src/context/processors/`): `historyTruncationProcessor`, `nodeTruncationProcessor`, `rollingSummaryProcessor`. Ognuno agisce su un grafo di nodi (USER_PROMPT, risultati…). Approccio: riduzione graduale, non un solo riassunto totale.
- `rollingSummaryProcessor.ts`: strategie `incremental` (riassume i 2 nodi più vecchi), `freeNTokens`, `max`; mantiene il primo prompt; riassume in modo **sincrono** con un modello economico (`gemini-3-flash-base`, ruolo `UTILITY_COMPRESSOR`); prompt di riassunto di una riga ("comprimi drasticamente"). [rollingSummaryProcessor.ts:43-77](https://github.com/google-gemini/gemini-cli/blob/cd1b45c2db0a5ea7b7fc3b67c1ba5879601d6005/packages/core/src/context/processors/rollingSummaryProcessor.ts#L43)

## Dolori
non letti (issue non esaminate: tetto di lavoro). `unknown`.

## Comportamento eseguito
non eseguito.

## Cosa copiare
- Riassunto con **modello più piccolo** e prompt corto; riduzione a pezzi piccoli (`incremental`) invece di grandi riassunti rari. Per noi: usare Haiku/Sonnet per il riassunto al posto di Opus potrebbe tagliare la quota, ma toglie un riassunto di qualità (da misurare).
## Cosa evitare
- Riassunto sincrono nel percorso del turno senza anticipo (blocca il turno).
