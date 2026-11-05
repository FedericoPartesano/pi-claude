# mem0ai/mem0

## Source Register
| Campo | Valore |
|---|---|
| Repository | https://github.com/mem0ai/mem0 |
| Commit | ed1f10fc87080f0b67f99be370817504888462ab (2026-11-04) |
| Letto il | 2026-11-04 |
| Canale di lettura | gh api |
| Licenza | Apache-2.0, copiabile: sì |
| Dimensione | 69.281 KB |

## Salute
Push 2026-11-04; ts-v3.3.1 (2026-09-25); primo contributore 453 commit contro 229 e 219; 904 issue aperte. Scorecard, advisory: non disponibili.

## Architettura
| Aspetto | Come fa | Evidenza | Profondità |
|---|---|---|---|
| Scrittura | `add(..., infer=True)`: un LLM estrae fatti con prompt «additivo» (solo ADD) | `mem0/memory/main.py:760-770, 950` | implementazione letta |
| Ricerca | `search` con BM25 lemmatizzato e reranker opzionale | `main.py:68, 505-510, 1393` | implementazione letta |

Permalink: https://github.com/mem0ai/mem0/blob/ed1f10fc87080f0b67f99be370817504888462ab/mem0/memory/main.py#L760

## Dolori
| Dolore | Evidenza | Che cosa insegna |
|---|---|---|
| L'estrazione solo-ADD può far emergere fatti superati o contraddittori | issue #4956 | senza regola di aggiornamento il vecchio valore torna: serve il caso «aggiornamento» nel banco |
| «Cecità temporale», conflitti semantici, CRUD mancante | issue #5352 (54 commenti) | stesso problema, il più discusso |
| Perdita silenziosa se l'embedding batch fallisce in parte | issue #5245 | contare i chunk indicizzati contro quelli attesi |
| Richiesta di verifica di fedeltà prima della scrittura | issue #7283 | riscrivere i fatti con un LLM può inventare: l'archivio grezzo no |

## Comportamento eseguito
non eseguito: richiede un LLM per `add`.

## Cosa copiare
- BM25 con lemmatizzazione (nostro `tokens()` non fa stemming) — main.py:68 — copiabile, valutare per l'italiano
## Cosa evitare
- Fatti riscritti dal modello come unica fonte (#4956, #7283).
