---
type: comparison
title: Compact di Pi contro billion-context (profilo v2)
tags: [contesto, misura]
related: [partesano-2026-eval-fold, billion-context-pi, extension-archivio]
created: 2026-11-23
updated: 2026-11-23
---

# Compact di Pi contro billion-context (profilo v2)

Banco a turni di [[partesano-2026-eval-fold]] (`eval/fold/REPORT.md` §5), haiku, 3 run per lato, archivio acceso in entrambi. Costo pesato = input + 0,1·cacheRead + 1,25·cacheWrite + 5·output.

| | off (compact di Pi) | v2 ([[billion-context-pi]]) |
|---|---|---|
| Token in totali | 2,612M | 2,558M (−2%) |
| Scritture in cache | 1,075M | 0,779M (−28%) |
| Costo pesato | 1,515M | 1,282M (−15%) |
| Contesto vivo massimo | 123,8k | 81,0k |
| Compact di Pi | 2 | 0 |
| Spawn / `--resume` del bridge | 20 / 15 | 26–27 / 25–26 |
| Richiamo dei 7 valori | 6,7/7 | 7/7 |
| Richiamo senza archivio automatico (1 run) | 0/7 | 7/7 |

Il ponte di [[extension-archivio]] da solo porta il compact di Pi da 0/7 a 6–7/7. Non provato: sessioni di ore o giorni, centinaia di turni, domande senza identificatori, ripresa in una sessione nuova.
