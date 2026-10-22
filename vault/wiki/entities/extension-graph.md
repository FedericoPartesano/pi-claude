---
type: entity
title: Estensione graph
tags: [estensione, grafo]
related: [partesano-2026-changelog, tool-su-richiesta, costo-fisso-in-token]
created: 2026-10-22
updated: 2026-10-22
---

# Estensione graph

Introdotta in 0.8.0 ([[partesano-2026-changelog]]). `/graph` apre una finestra a schede: Stato, Interroga, Nodi, Report, Lavoro.

- Motore Graphify con pannello di avanzamento, filtro del rumore e passaggio semantico via Claude Code; motore proprio con `PI_GRAPH_ENGINE=custom`.
- Il grafo entra nel prompt e nei tool solo se fresco (controllo all'avvio e dopo la build): coerente con [[costo-fisso-in-token]].
- Modale fisso con avanzamento, log dal vivo e contatore di cache; output di graphify senza buffer perché il pannello si aggiorni.
- Comando `html` nella scheda Stato: crea e apre il grafo interattivo.
- Alias di tsconfig e workspace inclusi; sezione GRAFO nel pannello laterale.
