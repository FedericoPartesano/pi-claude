---
type: concept
title: Router delle skill
tags: [token, skills]
related: [costo-fisso-in-token, tool-su-richiesta]
created: 2026-11-13
updated: 2026-11-13
---

# Router delle skill

`extensions/skills-router.ts` + `skills/router.json`: regole pesate nel codice, 0 token e ~0,006 ms per messaggio. Due fasce: `autoThreshold` 3 inietta il SKILL.md (~3,3k token), 2-3 solo suggerisce (chip). Cornice di richiesta (imperativo/«voglio») e veto (hook, tempo passato, «piano N», URL). Su 500 messaggi reali nuovi, giudice Opus: precisione auto 100% (IC95% 96-100), ma ~90% delle attivazioni è git («committa»); richiamo 10%. Fascia suggerimento 49%. A/B: stessa correttezza, costo +1,5%. Dettagli: `eval/skills-router/REPORT.md`.
