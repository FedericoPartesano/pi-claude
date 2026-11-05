# thedotmack/claude-mem

## Source Register
| Campo | Valore |
|---|---|
| Repository | https://github.com/thedotmack/claude-mem |
| Commit | d8bf121ae98063e5e3158befff33a9d635c0246b (2026-11-04) |
| Letto il | 2026-11-04 |
| Canale di lettura | gh api (contenuti raw, nessun clone) |
| Licenza | Apache-2.0, copiabile: sì |
| Dimensione | 768.898 KB |

## Salute
Push 2026-11-04; release v15.9.0 (2026-11-02); primo contributore 2.595 commit contro 246 e 78 (concentrato); 133 issue aperte. Scorecard e advisory: non disponibili.

## Architettura
| Aspetto | Come fa | Evidenza | Profondità |
|---|---|---|---|
| Iniezione | Blocco `<claude-mem-context>…` scritto in un file, con delimitatori su riga propria e gestione di fence non chiusi | `src/utils/context-injection.ts:6-35` | implementazione letta |
| Costruzione | Intestazione con economia di token, timeline osservazioni+riassunti, ultimo riassunto, sezione «Previously», footer | `src/services/context/ContextBuilder.ts:110-150` | implementazione letta |
| Limite | Il blocco è adattato a un tetto e riferisce cosa è sopravvissuto | `ContextBuilder.ts:349-363` | implementazione letta |
| Ricerca | Strategia ibrida: SQLite per filtri, Chroma solo per ordinare; se Chroma non risponde, ordine per data | `src/services/worker/search/strategies/HybridSearchStrategy.ts:52-94` | implementazione letta |
| Stato | SQLite + Chroma, worker separato; osservazioni generate da un modello «observer» | alberi del repo | fonte legata |

Permalink: https://github.com/thedotmack/claude-mem/blob/d8bf121ae98063e5e3158befff33a9d635c0246b/src/services/context/ContextBuilder.ts#L110

## Dolori
| Dolore | Evidenza | Che cosa insegna |
|---|---|---|
| Il plugin consuma il 50% dei token | issue #4965 | l'estrazione fatta da un modello costa quanto o più del recupero |
| Turni da ~100K token per ogni chiamata di tool nell'observer | issue #5023 | un generatore laterale può dominare il costo |
| Ipotesi: iniezione mutevole a ogni turno costa attenzione al compito, a prescindere dal volume | issue #4931 | iniettare spesso peggiora anche la qualità, non solo i token |
| «~10x di risparmio» non verificabile, recall della ricerca MCP non misurato | issue #4138 | senza banco proprio le affermazioni non reggono: il nostro banco `dump` è il vantaggio |
| Iniezione che spezza i file dell'utente | commenti su fence/BOM in `context-injection.ts:9-27` | meglio iniettare nel messaggio, non in un file |

## Comportamento eseguito
non eseguito: richiede worker, SQLite e Chroma; nessun beneficio per la decisione.

## Cosa copiare
- Tetto sul blocco con rapporto su cosa è stato tagliato — ContextBuilder.ts:349 — copiabile
- Ricerca che degrada a ordine per data se il motore semantico è assente — HybridSearchStrategy.ts:89 — copiabile
## Cosa evitare
- Osservazioni riscritte da un modello (costo, issue #4965/#5023) e iniezione a ogni turno (#4931).
