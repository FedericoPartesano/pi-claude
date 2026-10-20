---
type: comparison
title: Solo vettori contro ibrido
tags: [ricerca, misura]
related: [ricerca-ibrida, partesano-2026-eval-vault, extension-vault]
created: 2026-10-20
updated: 2026-10-20
---

# Solo vettori contro ibrido

Hit = file atteso fra i primi 3 ([[partesano-2026-eval-vault]]).

| Corpus | | solo vettori | ibrido |
|---|---|---|---|
| pi-claude (12 query) | totale | 8 | 10 |
| | token esatti (5) | 1 | 5 |
| | concetti (5) | 5 | 5 |
| | risultati fuori tema (2 query) | 0 | 1 |
| smartlookup-mono (15 query) | totale | 13 | 13 |
| | token (6) | 6 | 6 |
| | concetti (6) | 5 | 5 |

Conclusione: BM25 tenuto. Vince netto sui token esatti nel primo corpus e non peggiora il secondo. Dopo la correzione per le query lunghe, sul repo pi-claude i token esatti scendono da 5/5 a 4/5 e i risultati fuori tema da 6 a 1: compromesso accettato. Limite: query scritte da chi ha scritto il codice, campione piccolo.
