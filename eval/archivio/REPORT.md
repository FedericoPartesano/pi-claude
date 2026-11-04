Aggiornato: 2026-11-03

# Archivio della storia compattata (`extensions/archivio.ts`, tool `richiama`)

Idea: contesto vivo piccolo, storia completa in archivio (il file di sessione di Pi), consultata in modo mirato. Il tool si accende solo dopo la prima compattazione; il risultato arriva in coda (cache intatta); ricerca lessicale BM25, nessuna dipendenza.

## Misura: il dettaglio di prima della compattazione si ritrova?
`node eval/archivio/recall-probe.mjs <sessioni>`: 3 sessioni vere compattate (pi-claude ×2, smartlookup), 192 sonde. Risposta = un token distintivo (percorso:riga, numero, identificatore) preso dal testo archiviato; domanda = 4 parole vicine, senza il token.

| k | trovati | estratto medio |
|---|---|---|
| 4 | 180/192 (94%) | 2.605 caratteri (~700 token) |
| 8 | 184/192 (96%) | 5.083 caratteri |

Limiti: le sonde derivano dallo stesso testo cercato (proxy facile, il modello vero formula domande diverse); non misura l'uso reale del tool da parte del modello né la qualità finale. Da provare con domande scritte a mano e nel TUI.

## Cosa abilita
`compaction.keepRecentTokens` più basso (10000; contesto post-compattazione 57k → ~40k, −9…−10% simulato) senza perdere i dettagli: effetto sulla qualità da misurare con compiti a risposta nota.

## Recupero automatico (2026-11-04)
Il modello non deve ricordarsi del tool: prima di ogni richiesta, se un pezzo archiviato condivide ≥4 termini (e ≥40%) con la richiesta, i 3 estratti migliori (≤1.500 caratteri) vanno in coda come messaggio `archive-recall` (cache intatta). `richiama id=#xxxx` apre una voce intera. Spegnere: `PI_ARCHIVE_AUTO=0`.

Frequenza di scatto sui prompt veri dopo una compattazione (174 prompt, 3 sessioni, `/tmp/auto-rate.mjs`):
| soglia termini | scatta | estratto medio |
|---|---|---|
| 2 | 75% | 1.061 car. |
| 3 | 31% | 990 |
| 4 (default) | 18% | 992 (~280 token) |
| 5 | 10% | 938 |
Non misurata la pertinenza degli estratti (se aiutano davvero la risposta): serve il test a risposta nota.
