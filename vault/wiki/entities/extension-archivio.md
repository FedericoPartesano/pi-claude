---
type: entity
title: Estensione archivio
tags: [estensione, contesto, memoria]
related: [tool-su-richiesta, costo-fisso-in-token, ricerca-ibrida, extension-vault]
created: 2026-11-05
updated: 2026-11-05
---

# Estensione archivio

`extensions/archivio.ts`: rende ricercabile la storia che la compattazione di Pi toglie dal contesto vivo. Intent: `intents/2026-11-04-portare-il-recupero-della-storia-compattata.md`; studio: `docs/architetto/contesto-secondario-recupero/`; misure: `eval/ab/REPORT.md` §7–16.

- Tool `richiama` (BM25), attivato alla prima compattazione (costo fisso zero prima); il modello nei banchi non lo ha mai chiamato.
- Recupero automatico a ogni turno: semantico con e5 locale (`WorkerEmbedder`, indice in background, ripiega sul lessicale), soglia z ≥ 4,2 (`PI_ARCHIVE_SEM_Z`), ≤1500 caratteri, marcato come dato citato, una volta per voce, filtro `repeatsPrompt`.
- Variabili: `PI_ARCHIVE=0`, `PI_ARCHIVE_SEM=0`, `PI_ARCHIVE_AUTO=0`, `PI_ARCHIVE_SEM_Z`.
- Misure (haiku, banco `noid`: senza identificatori nella domanda, ≥9 compattazioni): corrette 36/36 contro 23/36 del default (64%); iniezioni sbagliate 12,5% (obiettivo ≤10% non raggiunto); latenza nel turno ≈29 ms mediana, ≈50 ms p95.
- Costo: nessun risparmio sulle sole letture (+1,7%, causa: l'attivazione di `richiama` rompe la cache, ≈8.800 pesati una volta per sessione); con dati non rileggibili −16,5% e 18/18 contro 1/18.
- Comando `/archivio` (`pi-ui/src/archive-view.ts`): vista a schermo intero con schede Iniezioni, Voci e Prova; le iniezioni salvano `details` (prompt, metodo, voci con z) nel messaggio `archive-recall`.
- Test: `node --test extensions/archivio.test.ts`.
