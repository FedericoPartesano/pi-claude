# anomalyco/opencode

## Source Register
| Campo | Valore |
|---|---|
| Repository | https://github.com/anomalyco/opencode |
| Commit | 5bf3e82f71817493b997cd011467d0a7a8984bd8 (dev, 2026-10-26) |
| Letto il | 2026-10-26 |
| Canale | `gh api` (file singoli, nessun clone) |
| Licenza | MIT — copiabile: sì |
| Dimensione | 602 MB |

## Salute
Push 2026-10-26; 221.780★; 3.836 issue aperte; primo contributore 2.964 su ~8k (≈37%, top-3 sommano 2.964/2.641/2.415). Scorecard non disponibile (non cercato). Fonte: `gh api`.

## Architettura (compattazione) — fatti dal codice
| Aspetto | Come fa | Evidenza | Profondità |
|---|---|---|---|
| Soglia | tetto = finestra − max(15% finestra, 16k); `buffer` configurabile, ignorato se non lascia spazio | [compaction.ts:134](https://github.com/anomalyco/opencode/blob/5bf3e82f71817493b997cd011467d0a7a8984bd8/packages/core/src/session/compaction.ts#L134), `calculateCeiling` ~L1115 | letta |
| Riassunto **che legge la cache** | la richiesta di riassunto invia la conversazione intera con il prefisso identico + il prompt di riassunto | commento a ~L434-438 | letta |
| **Riassunto in anticipo** | a 85% del tetto (min 64k token) riassume in background tutto fino all'ultima risposta; lo **tiene da parte** senza applicarlo, per non rompere la cache; lo scambia solo quando la compattazione è dovuta | [compaction.ts:153, 330-336](https://github.com/anomalyco/opencode/blob/5bf3e82f71817493b997cd011467d0a7a8984bd8/packages/core/src/session/compaction.ts#L330) | letta |
| Coda tenuta | `keep.tokens`; la coda dopo il riassunto ≤ 2×keep, min 30k, max ¼ del budget, altrimenti riassume da capo | ~L155-160 | letta |
| Se non entra | trascrizione in testo; livelli di accorciamento (output tagliati → tolti → solo testo utente → omesso), dal più vecchio; risultati tool e input tagliati a 2.000 caratteri | L126-150 | letta |
| **Immagini** | `boundImages`: sopra 25 MiB totali toglie le più vecchie fino a 15 MiB, sostituendole con un testo che dice di rileggerle; il taglio si sposta solo ogni (25−15) MiB, per non rompere la cache a ogni richiesta | [model-request.ts:42-45, 182-208](https://github.com/anomalyco/opencode/blob/5bf3e82f71817493b997cd011467d0a7a8984bd8/packages/core/src/session/model-request.ts#L182) | letta |
| Stima immagine | 1.500 token (PDF 2.000) per le stime | compaction.ts:150 | letta |
| Riassunto e media | la trascrizione lascia fuori ragionamento, media, istruzioni | ~L665 | letta |

## Dolori (issue)
| Dolore | Evidenza | Che cosa insegna |
|---|---|---|
| Compattazione in ciclo: provider segnala input sopra il limite | https://github.com/anomalyco/opencode/issues/50474 (aperta) | stesso sintomo del Mac; serve un tetto ai tentativi |
| Ciclo infinito se system prompt + tool superano lo spazio utile | #54993 (chiusa) | controllo di fattibilità prima di riprovare |
| Ciclo "sempre in ricompattazione" | #56350 (chiusa) | idem |
| `buffer` di 180.904 su finestra 200k lascia 15k | https://github.com/anomalyco/opencode/issues/58774 (aperta) | un `reserveTokens` alto riduce lo spazio utile: caso identico al nostro 80000 |
| Degrado e "Thinking" lungo dopo molte compattazioni | #50103 | la qualità cala con le catene di riassunti |

## Comportamento eseguito
non eseguito: il repo è un monorepo da 600 MB, e la logica non gira senza provider.

## Cosa copiare
- Riassunto in anticipo + scambio solo a soglia: idea e struttura (MIT).
- Prefisso identico per il riassunto: **non applicabile tal quale** a `claude -p` (il bridge non controlla la richiesta di riassunto di Pi), da verificare.
- `boundImages` a doppia soglia (25/15 MiB): MIT, ~25 righe, adattabile al limite in byte.
## Cosa evitare
- `buffer` assoluto alto senza controllo di spazio utile (#58774).
