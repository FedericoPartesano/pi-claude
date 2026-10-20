---
type: synthesis
title: Decisioni di progetto
tags: [decisioni]
related: [partesano-2026-notes, partesano-2026-handoff, partesano-2026-eval-vault]
created: 2026-10-20
updated: 2026-10-20
---

# Decisioni di progetto

- **Estensione, non fork**: `pi.registerProvider` basta; si resta allineati a Pi ([[partesano-2026-notes]], [[pi-claude-code]]).
- **Abbonamento, non API con OAuth**: le API con OAuth da harness di terzi sono extra usage; il [[bridge-mcp-lockstep]] usa la CLI ufficiale.
- **Tool su richiesta**: −68% di token sulla prima richiesta di pi-full ([[tool-su-richiesta]], [[partesano-2026-handoff]]).
- **Vault locale con conferma**: indice fuori da git, niente indicizzazione senza stima e conferma ([[extension-vault]]).
- **BM25 tenuto**: misurato migliore sui token esatti ([[solo-vettori-vs-ibrido]]).
- **Misurare prima di affermare**: ogni scelta su costo o qualità ha un report in `eval/` o `bench/`, anche negativo.
- **Commit**: Conventional Commits, versione gestita da release-please; nessun commit o push senza richiesta.
