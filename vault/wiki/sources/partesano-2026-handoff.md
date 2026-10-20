---
type: source
title: HANDOFF.md — ripresa lavori
tags: [fonte, stato]
related: [pi-claude-code, tool-su-richiesta, pi-ui]
created: 2026-10-20
updated: 2026-10-20
authors: [Federico Partesano]
year: 2026
url: "HANDOFF.md"
venue: "repository pi-claude"
---

# HANDOFF.md

Stato dei lavori per riprendere dopo un'interruzione. Punti chiave:
- Bridge funzionante, Pi 1.0.4, comandi `pi` (~3,6k token per richiesta) e `pi-full` (~3,8k).
- Valutazione su 50 casi (`eval/REPORT.md`): Pi 50/50 dopo le correzioni, −90% token di input e −30/35% di tempo rispetto a Claude Code.
- [[tool-su-richiesta]]: prima richiesta da 11,7k a 3,8k token.
- [[pi-ui]], intent, goal, loop, picker e memoria con i rispettivi branch e spec.
