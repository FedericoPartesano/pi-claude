# vectorize-io/hindsight

## Source Register
| Campo | Valore |
|---|---|
| Repository | https://github.com/vectorize-io/hindsight |
| Commit | 047350acf96167534409e5d87a07b8b2ee1469f9 (2026-11-04) |
| Letto il | 2026-11-04 |
| Canale di lettura | gh api |
| Licenza | MIT, copiabile: sì |
| Dimensione | 834.528 KB |

## Salute
Push 2026-11-04; v1.2.0 (2026-11-03); primo contributore 2.255 commit contro 385 e 347; 189 issue aperte. Scorecard, advisory: non disponibili.

## Architettura
| Aspetto | Come fa | Evidenza | Profondità |
|---|---|---|---|
| Recupero | Quattro bracci (semantico, BM25, grafo, temporale) fusi con RRF e, di default, riordinati da un cross-encoder | `hindsight-api-slim/hindsight_api/engine/memory_engine.py:787-794` | implementazione letta |
| Fusione | `reciprocal_rank_fusion(..., k=60)` | `engine/search/fusion.py:29` | implementazione letta |
| Budget | Candidati del reranker per livello (low/mid/high) | `memory_engine.py:1760-1771` | implementazione letta |
| Moduli | `search/{bm25_term_selection,recall_boost,decision_reranker,graph_retrieval}.py`, `reflect/`, `retain/` | albero | fonte legata |

Permalink: https://github.com/vectorize-io/hindsight/blob/047350acf96167534409e5d87a07b8b2ee1469f9/hindsight-api-slim/hindsight_api/engine/memory_engine.py#L787

## Dolori
| Dolore | Evidenza | Che cosa insegna |
|---|---|---|
| Probe compilato JIT a ogni recall | issue #6306 | la latenza del recall si rompe facilmente: il nostro tetto 50 ms va misurato |
| Il reranker decisionale si interrompe sui rifiuti del modello; retry amplificano i guasti | issue #6242 | un reranker basato su LLM aggiunge un modo di fallire; BM25 non ne ha |
| Reflect e recall condividono lo stesso budget | issue #6246 | budget separati per iniezione e per richiamo esplicito |

## Comportamento eseguito
non eseguito: richiede Postgres e modelli.

## Cosa copiare
- RRF con k=60 per fondere BM25 e embedder locale — fusion.py:29 — copiabile
- Modalità di riordino selezionabile (cross_encoder / rrf / interleave) — memory_engine.py:794 — copiabile
## Cosa evitare
- Reranker con LLM nel percorso di ogni recall (#6242); infrastruttura pesante (Postgres, cross-encoder) incompatibile con «nessuna dipendenza nuova».
