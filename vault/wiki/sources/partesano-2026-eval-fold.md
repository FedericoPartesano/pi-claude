---
type: source
title: eval/fold/REPORT.md — compressione del contesto con billion-context-pi
tags: [fonte, misura, contesto]
related: [billion-context-pi, compact-pi-vs-billion-context, extension-archivio, costo-fisso-in-token]
created: 2026-11-23
updated: 2026-11-23
authors: [Federico Partesano]
year: 2026
url: "eval/fold/REPORT.md"
venue: "repository pi-claude"
---

# eval/fold/REPORT.md

Misure di [[billion-context-pi]] col bridge [[pi-claude-code]] e haiku. Banco a turni (`eval/fold/turns.sh`): 14 file grandi letti in 15 invocazioni di `pi -p` sulla stessa sessione, poi il richiamo di 7 costanti senza rileggere i file. Storia ~190k token stimati.

- Costo fisso per richiesta: off 26.584, profilo lean 33.133, profilo completo 35.764, profilo v2 31.103 token.
- Primo profilo (lean, senza finestra di lavoro né archivio): token da +3% a +17% su off, richiamo 1 run su 4.
- Profilo v2 più ponte archivio, 3 run per lato: confronto in [[compact-pi-vs-billion-context]].
- Difetti trovati e corretti durante le misure: `pi -p` appeso 10 minuti dopo un compact (`pi-memory/src/embed.ts`), caveman che riassumeva un compact annullato, lean-tools che diceva "invariato" dopo un `compress`.
- Chat lunga con ripresa (§6, `eval/fold/long.py`, 29 turni, quiz di 14 valori prima e dopo un `--continue`): profilo vB contro off, costo pesato −10,6%, cacheWrite −23%, spawn del bridge 8 contro 15, compact di Pi 0 contro 4, recall 14/14 per entrambi. Difetti corretti: tool result persi alla ripresa, JSON malformato a `compress`, evizione del pool a metà tool call, riavvii per la troncatura d'emergenza, costanti di file chiesti a parole (`constRecall` in [[extension-archivio]]).
