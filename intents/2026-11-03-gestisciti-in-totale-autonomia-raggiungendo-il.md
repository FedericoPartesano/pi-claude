---
status: in-progress
created: 2026-11-03
source: user
---

# Risparmio del 30% di quota alzando la qualità

## Problema
Il costo di una sessione Pi (abbonamento Claude Code) è dominato da cacheRead (46%), cacheWrite (27%), output (18%) e compattazioni (9%). Lo studio `docs/architetto/garbage-collector-contesto/40-piano-30.md` stima che impilando più leve si arrivi al 30%, ma solo in simulazione. L'obiettivo: raggiungere ≥30% di risparmio **misurato** sull'uso reale, senza peggiorare la qualità delle risposte, anzi alzandola.

## Outcome atteso
- [ ] Banco di misura riproducibile (script in `eval/`) che esegue un carico fisso di compiti con configurazione base e con le leve, e somma `usage` reale per giro con i pesi 0,1/1,25/5.
- [x] Baseline misurata (replay di 3 sessioni vere + 8.537 giri): ripartizione costo, giri freddi — prova: `docs/architetto/garbage-collector-contesto/40-piano-30.md`, `sim-gc.cjs`
- [x] Leva "prefisso stabile" per `goal_done`: non si spegne più a fine goal (`extensions/goal.ts` `finish`) — prova: `node --test extensions/goal.test.ts` 18/18 verdi. (Memoria: cambi rari, 0,2M su 146,7M, non toccata.)
- [x] Leva "compattazione": `keepRecentTokens` 10000 in `~/.pi/agent/settings.json` — prova: simulato −9…−10% su 3 sessioni (nessun codice, nessun test). Riassunto sul prefisso in cache: non implementato.
- [ ] Leva "tetto alla fonte" e prompt fisso più corto, con test dove c'è codice.
- [ ] Risparmio misurato sull'uso reale ≥ 30% rispetto alla baseline (costo pesato per lo stesso carico), riportato in `eval/REPORT.md` anche se negativo.
- [ ] Qualità non peggiore, e se possibile migliore: compiti a risposta nota (inclusi dettagli recenti dopo compattazione) con punteggio ≥ baseline, riportato nel report.
- [ ] Test automatici verdi (`node --test extensions/*.test.ts`, tsc dei pacchetti toccati) e wiki/README aggiornati.
- [ ] Prova manuale dell'utente nel TUI reale dopo `/custom-reload` (sessione vera con le leve attive).

- [x] Archivio della storia compattata (contesto piccolo + archivio consultabile): `extensions/archivio.ts` (tool `richiama`, acceso dopo la compattazione) — prova: `node --test extensions/archivio.test.ts` 4/4; `node eval/archivio/recall-probe.mjs` 180/192 (94%, k=4); `eval/archivio/REPORT.md`

## Utenti e sistemi impattati
Utente di Pi con modelli Claude via bridge `pi-claude-code`; estensioni `pi-memory`, `goal`, `lean-tools`, `context-tiers`, `caveman`, impostazioni di compattazione in `~/.pi/agent/settings.json`.

## Vincoli
- Nessun commit/push senza richiesta esplicita.
- Nessuna dipendenza nuova.
- Funziona su Linux, macOS, WSL; commenti in inglese, documenti in italiano.
- Costo fisso di prompt il più basso possibile; ogni affermazione su prestazioni misurata e riportata in `eval/`, anche se negativa.
- Pi non segue i symlink negli import relativi; non importare `pi-tui` dalle estensioni.
- Le prove nel TUI le fa l'utente.

## Domande aperte
- Pesi reali dell'abbonamento (oggi 0,1/1,25/5 da prezzi API).
- Se il carico misurato rappresenta le sessioni vere (lunghe, con compattazioni).

## Verifica
```bash
node --test extensions/*.test.ts
node eval/gc-bench.mjs --help
```
