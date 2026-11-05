# letta-ai/letta (e letta-ai/letta-code)

## Source Register
| Campo | Valore |
|---|---|
| Repository | https://github.com/letta-ai/letta |
| Commit | 8816d3a8516893bfdc0fa14bfb1235226012e295 (2026-10-18) |
| Letto il | 2026-11-04 |
| Canale di lettura | gh api (README e albero di letta-code) |
| Licenza | Apache-2.0, copiabile: sì |

## Salute
letta: release 0.16.8 (2026-05-14), 25.346 ★, 3 contributori a ~1.200-2.000 commit. Il README dice che il codice attivo è in `letta-ai/letta-code` (3.777 ★, push 2026-11-04, commit e6d6cc27ef11, Apache-2.0); il server V1 è sul branch `archive`. «0 issue aperte» di `gh api` quindi non indica salute.

## Architettura
| Aspetto | Come fa | Evidenza | Profondità |
|---|---|---|---|
| Stato attuale | harness + UI + App Server in letta-code; compattazione in `src/backend/local/compaction.ts`, prompt di compattazione modificabile dall'agente (`skills/builtin/self-configuration/…/update-compaction-prompt.ts`) | albero di letta-code | fonte legata |
| Archival memory | **unknown**: codice di ricerca non letto; il modello (core/recall/archival, chiamata di funzione) è quello descritto da MemGPT | – | unknown |

## Dolori
| Dolore | Evidenza | Che cosa insegna |
|---|---|---|
| Il repo originale è stato ritirato e il codice è migrato | README.md | l'idea MemGPT è sopravvissuta ma il codice si sposta: copiare l'idea, non il codice |

## Comportamento eseguito
non eseguito.

## Cosa copiare
- Solo l'idea: richiamo esplicito dell'agente come tool (già in `richiama`).
## Cosa evitare
- Dipendere da un server di stato separato.
