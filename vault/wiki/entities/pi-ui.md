---
type: entity
title: pi-ui
tags: [pacchetto, interfaccia]
related: [costo-fisso-in-token, pi-claude-code]
created: 2026-10-20
updated: 2026-10-30
---

# pi-ui

Chat "Neon Night": barra di stato (`PRONTO`, `AL LAVORO`, `TOCCA A TE`, `FERMO`, `FATTO`), passi compatti, miniature di immagini, suggerimenti 1-4, conferma dei comandi pericolosi nella barra, pannello laterale (`Alt+S`). `PI_UI=off` torna alla chat originale. I suggerimenti costano ~70 token di istruzione in cache ([[costo-fisso-in-token]]).

## Sezione USO del pannello

Barre 5H, 7G e CTX a tutta larghezza, percentuale allineata a destra. Sotto 5H e 7G righe a due colonne: `Reset` (orario, con giorno se non è oggi), `Consumo`, `Esaurimento`, `Prima del reset`, oppure `Al reset restano ~X%`.

- Stima: regressione lineare sui campioni di utilizzo. 5H: ultimi 10 minuti, serve almeno 3 minuti di dati. 7G: ultime 3 ore, almeno 30 minuti (la percentuale settimanale si muove di 1% ogni ~100 minuti). Prima: `Previsione dopo N min d'uso`.
- Se la stima supera il limite prima del reset, la barra diventa rossa e le righe `⚠ Esaurimento` e `Prima del reset` sono in rosso grassetto.
- Dati: [[pi-claude-code]] scrive in `~/.pi/agent/claude-code-usage.json` utilizzo, orari di reset e storia dei campioni (15 min per 5H, 6 h per 7G, uno ogni 30 s al massimo) a ogni `rate_limit_event`; codice in `pi-ui/src/usage.ts`. La storia riparte da zero al riavvio di Pi.
- Limiti: nessun test automatico per `forecastLines` e `resetLabel`; la percentuale ha risoluzione 0,01, quindi le prime stime possono oscillare.
