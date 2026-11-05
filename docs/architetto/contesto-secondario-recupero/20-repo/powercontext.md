# oceanbase/powercontext

## Source Register
| Campo | Valore |
|---|---|
| Repository | https://github.com/oceanbase/powercontext |
| Commit | 2853ed98a6ab767f6bbfe35098024d5f9cec9a2b (2026-11-04) |
| Letto il | 2026-11-04 |
| Canale di lettura | gh api |
| Licenza | Apache-2.0, copiabile: sì |
| Dimensione | non letta |

## Salute
Push 2026-11-04; powercontext-v1.5.0 (2026-11-03); contributori 119/95/88 (distribuiti); 136 issue aperte. Scorecard, advisory: non disponibili.

## Architettura
| Aspetto | Come fa | Evidenza | Profondità |
|---|---|---|---|
| Hook | `SessionStart` (startup, resume, clear, compact, fork) e `UserPromptSubmit`, timeout 10 s | `integrations/claude-code/plugins/powercontext/hooks/hooks.json` | implementazione letta |
| Limite | Contesto preparato ≤ 8.000 byte, schema validato | `hooks/prepared_context.py:22-36` | implementazione letta |
| Query | Prompt lungo: si tiene la coda (il turno in corso), tagliata per carattere e per byte UTF-8 | `prepared_context.py:71-89` | implementazione letta |

Permalink: https://github.com/oceanbase/powercontext/blob/2853ed98a6ab767f6bbfe35098024d5f9cec9a2b/integrations/claude-code/plugins/powercontext/hooks/prepared_context.py#L71

## Dolori
| Dolore | Evidenza | Che cosa insegna |
|---|---|---|
| In corso: baseline riproducibili di costo token e latenza | issue #2467 | anche loro non hanno ancora misure di costo; il nostro banco è un passo avanti |
| Retention delle prove limitata, esiti completi delle chiamate | issue #2463 | il recupero iniettato va registrato (la riga di stato e `/archivio` del brief) |

## Comportamento eseguito
non eseguito: richiede server Core.

## Cosa copiare
- Hook su `compact` e `resume` oltre che su startup — hooks.json — copiabile (verifica del brief)
- Query = coda del prompt, tagliata a limite — prepared_context.py:71 — copiabile
## Cosa evitare
- Server separato con gateway (decine di issue di infrastruttura): troppo per un'estensione Pi.
