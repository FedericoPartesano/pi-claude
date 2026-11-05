# getzep/graphiti

## Source Register
| Campo | Valore |
|---|---|
| Repository | https://github.com/getzep/graphiti |
| Commit | fb60e59d4a208c99e7d0186ee6335d2a257f17f2 (2026-11-03) |
| Letto il | 2026-11-04 |
| Canale di lettura | gh api |
| Licenza | Apache-2.0, copiabile: sì |
| Dimensione | 16.498 KB |

## Salute
Push 2026-11-03; v0.31.2 (2026-10-20); primo contributore 356 commit contro 294 e 108; 542 issue aperte. Scorecard, advisory: non disponibili.

## Architettura
| Aspetto | Come fa | Evidenza | Profondità |
|---|---|---|---|
| Ricerca | Ricette di configurazione: BM25 + coseno, fusione RRF o MMR, su archi, nodi, episodi, comunità | `graphiti_core/search/search_config_recipes.py:34-60` | implementazione letta |
| Tempo | Ogni arco ha `valid_at`/`invalid_at`/`expired_at`; un fatto nuovo che contraddice scade quello vecchio | `graphiti_core/utils/maintenance/edge_operations.py:310-371, 719-731` | implementazione letta |
| Stato | Database a grafo (esterno) | albero | fonte legata |

Permalink: https://github.com/getzep/graphiti/blob/fb60e59d4a208c99e7d0186ee6335d2a257f17f2/graphiti_core/utils/maintenance/edge_operations.py#L719

## Dolori
| Dolore | Evidenza | Che cosa insegna |
|---|---|---|
| `add_memory` risponde ok ma gli episodi possono cadere in silenzio | issue #1707 | l'ingestione asincrona deve dichiarare i fallimenti; la nostra indicizzazione incrementale deve contare i chunk |
| Estrazione tramite LLM con errori di validazione e dipendenza da Ollama/Bedrock | issue #912, #868, #459 | l'estrazione di fatti è fragile e costosa |

## Comportamento eseguito
non eseguito: richiede un database a grafo e un LLM.

## Cosa copiare
- Intervallo di validità sul dato e scadenza del superato, nella forma leggera: a pari rilevanza vince il più recente, con numero di turno — edge_operations.py:719 (idea; il codice dipende da LLM) — copiabile
## Cosa evitare
- Costruzione del grafo con LLM a ogni inserimento: incompatibile con costo ≤ default.
