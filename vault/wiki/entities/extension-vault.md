---
type: entity
title: Estensione vault
tags: [estensione, ricerca]
related: [ricerca-ibrida, pi-memory, partesano-2026-eval-vault, solo-vettori-vs-ibrido]
created: 2026-10-20
updated: 2026-10-20
---

# Estensione vault

`extensions/vault.ts` e `extensions/vault/`: indicizza i `CLAUDE.md` (progetto e `~/.claude/CLAUDE.md`) e il vault Obsidian (cartella con `.obsidian/`, anche fino a 2 livelli sotto il cwd, o `PI_VAULT`).

- Chunk per titoli H1-H4, sezioni lunghe spezzate a ~800 caratteri, blocchi di codice interi.
- Indice incrementale in `.pi/vault/` (fuori da git), hash per chunk.
- Tool `vault_search` e `vault_read`, attivi solo con un indice; una riga di prompt di ~37 token.
- Nessuna indicizzazione senza conferma, con stima prima.
- Ricerca: [[ricerca-ibrida]]. Misure: [[solo-vettori-vs-ibrido]].
- Test: `node --test extensions/vault.test.ts extensions/vault/vault.test.ts`.
