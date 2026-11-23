---
type: entity
title: Estensione archivio
tags: [estensione, contesto, memoria]
related: [billion-context-pi, tool-su-richiesta, costo-fisso-in-token, ricerca-ibrida, extension-vault]
created: 2026-11-05
updated: 2026-11-23
---

# Estensione archivio

`extensions/archivio.ts`: rende ricercabile la storia che la compattazione di Pi toglie dal contesto vivo. Intent: `intents/2026-11-04-portare-il-recupero-della-storia-compattata.md`; studio: `docs/architetto/contesto-secondario-recupero/`; misure: `eval/ab/REPORT.md` §7–16.

- Tool `richiama` (BM25), attivato alla prima compattazione (costo fisso zero prima); il modello nei banchi non lo ha mai chiamato.
- Recupero automatico a ogni turno: semantico con e5 locale (`WorkerEmbedder`, indice in background, ripiega sul lessicale), soglia z ≥ 4,2 (`PI_ARCHIVE_SEM_Z`), ≤1500 caratteri, marcato come dato citato, una volta per voce, filtro `repeatsPrompt`.
- Variabili: `PI_ARCHIVE=0`, `PI_ARCHIVE_SEM=0`, `PI_ARCHIVE_AUTO=0`, `PI_ARCHIVE_SEM_Z`.
- Misure (haiku, banco `noid`: senza identificatori nella domanda, ≥9 compattazioni): corrette 36/36 contro 23/36 del default (64%); iniezioni sbagliate 12,5% (obiettivo ≤10% non raggiunto); latenza nel turno ≈29 ms mediana, ≈50 ms p95.
- Costo: nessun risparmio sulle sole letture (+1,7%, causa: l'attivazione di `richiama` rompe la cache, ≈8.800 pesati una volta per sessione); con dati non rileggibili −16,5% e 18/18 contro 1/18.
- Comando `/archive` (`pi-ui/src/archive-view.ts`): vista a schermo intero con schede Iniezioni, Voci e Prova; le iniezioni salvano `details` (prompt, metodo, voci con z) nel messaggio `archive-recall`.
- Test: `node --test extensions/archivio.test.ts`.
- Ponte con [[billion-context-pi]] (2026-11-23): l'archivio comprende anche i messaggi dei blocchi compressi attivi (`foldedIds` legge `<sessione>.acp.json`, cache per mtime), reindicizza dopo ogni `compress`. Richiamo per identificatori (`keyRecall`): se il prompt nomina costanti (snake_case o MAIUSCOLE presenti in maiuscolo nell'archivio) inietta la riga di definizione esatta fino alla fine dell'istruzione, prima del semantico. Sul banco a turni porta il compact di Pi da 0/7 a 6–7/7 ([[compact-pi-vs-billion-context]]).
- Richiamo dei fatti dettati (`factRecall`) e delle costanti dei file chiesti a parole (`constRecall`, 2026-11-23): se una parte della domanda nomina un file letto per segmento di percorso («l'estensione vault», «il pannello di pi-ui») senza identificatori, inietta le costanti di primo livello di quel file. Guarda tutte le letture, non solo l'archivio: la troncatura d'emergenza di [[billion-context-pi]] toglie il centro di un file ancora vivo. Nella chat lunga scatta solo ai quiz (~570 caratteri) e porta vB da 12–13/14 a 14/14.
