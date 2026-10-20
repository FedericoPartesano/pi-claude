---
type: source
title: NOTES.md — Pi su abbonamento Claude Code
tags: [fonte, architettura]
related: [pi-claude-code, bridge-mcp-lockstep]
created: 2026-10-20
updated: 2026-10-20
authors: [Federico Partesano]
year: 2026
url: "NOTES.md"
venue: "repository pi-claude"
---

# NOTES.md

Storia tecnica del bridge. Punti chiave:
- Test di fattibilità di `claude -p` (CLI 2.1.281): 5/5 superati (contesto pulito con abbonamento, tool loop, processo persistente, partial messages, resume con fork).
- Decisione: estensione, non fork ([[pi-claude-code]]).
- Il nodo dei due agent loop e la soluzione [[bridge-mcp-lockstep]].
