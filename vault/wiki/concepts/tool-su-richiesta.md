---
type: concept
title: Tool su richiesta
tags: [token, pi-full]
related: [costo-fisso-in-token, pi-team, partesano-2026-handoff]
created: 2026-10-20
updated: 2026-10-20
---

# Tool su richiesta

In pi-full i gruppi `web`, `todo`, `subagent`, `team` e `parallel` partono spenti (`extensions/tool-groups.ts`). Il modello li accende con `load_tools` e li usa nello stesso turno; l'utente con `/tools`. Prima richiesta da 11,7k a 3,8k token ([[partesano-2026-handoff]]). `PI_FULL_TOOLS=web,team` li precarica, `PI_FULL_TOOLS=all` li tiene accesi.
