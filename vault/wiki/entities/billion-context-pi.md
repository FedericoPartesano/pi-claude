---
type: entity
title: billion-context-pi
tags: [pacchetto, contesto, terzi]
related: [partesano-2026-eval-fold, compact-pi-vs-billion-context, extension-archivio, costo-fisso-in-token]
created: 2026-11-23
updated: 2026-11-23
---

# billion-context-pi

Pacchetto Pi di terzi (MIT, ranxianglei/billion-context, motore `acp-kernel`) installato come predefinito da `install.sh` → `scripts/setup.mjs`, versione fissata `npm:billion-context-pi@0.1.83`, `autoUpdate: false`, `delegate: false`. Attribuzione nel README. Intent: `intents/2026-11-23-compressione-contesto-billion-context.md`.

- Sostituisce il compact di Pi (che annulla) con la compressione decisa dal modello: tool `compress` a range di messaggi, `decompress`, `search_context`, `acp_status`, `acp_cache`. Stato in `<sessione>.acp.json` accanto alla sessione.
- Profilo `scripts/acp-profile.json` (vB = v2 + `compress.minPressureBenefitTokens: 30000`), unito a `~/.pi/acp.json` senza toccare le chiavi dell'utente: regole tier 2/3 spostate nei nudge, HOW TO COMPRESS accorciato, sezioni THROTTLE RETRY e CONTEXT BREAKDOWN tolte, RECALL che chiede `search_context` prima di «non so», `modelContextLimit: 100000` come finestra di lavoro, `preserveRecentTools: ["read"]` contro il ciclo comprimi-e-rileggi.
- Il modello usa `decompress` solo se richiesto; i dettagli esatti tornano dai riassunti e da [[extension-archivio]], che indicizza i blocchi compressi.
- Adattamenti: caveman cede `session_before_compact` se esiste `compress`; lean-tools azzera il tracker delle riletture dopo un `compress`.
- Il bridge riavvia `claude` dopo ogni `compress` (cambia il prefisso della vista). La troncatura d'emergenza di billion-context (sopra il 95% del limite, 2000 caratteri per estremo) non causa più riavvii: l'impronta di un messaggio utente lungo si calcola sui suoi estremi (`fingerprintMessage` nel bridge).
- Chat lunga con ripresa (29 turni): vB costa il 10,6% in meno di off, 8 spawn contro 15, 0 compact di Pi, recall 14/14 prima e dopo la ripresa.
- Misure: [[partesano-2026-eval-fold]], [[compact-pi-vs-billion-context]].
