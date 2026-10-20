---
type: overview
title: pi-claude
tags: [overview]
related: [pi-claude-code, pi-ui, pi-memory, extension-vault]
created: 2026-10-20
updated: 2026-10-20
---

# pi-claude

Pacchetto Pi che usa i modelli Claude attraverso l'abbonamento Claude Code. Il cuore è [[pi-claude-code]], che collega i due agent loop con il [[bridge-mcp-lockstep]]. Intorno: la chat [[pi-ui]], il [[pi-picker]], i sub-agenti di [[pi-team]], la memoria di [[pi-memory]] e le estensioni, fra cui [[extension-vault]].

Il principio guida è il [[costo-fisso-in-token]] minimo: per esempio i [[tool-su-richiesta]] portano la prima richiesta di pi-full da 11,7k a 3,8k token ([[partesano-2026-handoff]]). Ogni scelta è misurata: vedi [[decisioni-di-progetto]].
