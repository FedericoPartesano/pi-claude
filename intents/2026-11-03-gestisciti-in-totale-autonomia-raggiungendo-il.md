---
status: in-progress
created: 2026-11-03
source: user
---

# Contesto allargato a costo uguale: richiamo di dati vecchi, anche senza identificatori

## Problema
Dopo una compattazione il riassunto perde i dettagli. L'archivio (`extensions/archivio.ts`) li tiene consultabili, ma recupera bene solo con identificatori nella domanda. Obiettivo (dell'utente, 2026-11-04): ampliare di molto il contesto effettivo con lo stesso uso di token, senza costi in più. Il 30% di risparmio non è più l'obiettivo. Studio: `docs/architetto/contesto-secondario-recupero/` (candidata D: ibrido BM25+e5 con riscrittura delle query).

## Outcome atteso
- [x] Banco di misura riproducibile (script in `eval/`) con carico fisso e pesi 0,1/1,25/5. — prova: `eval/ab/run.mjs` (bracci A–E, modi short/long/hard/dump), `eval/ab/REPORT.md`
- [x] Baseline misurata (replay di 3 sessioni vere + 8.537 giri). — prova: `docs/architetto/garbage-collector-contesto/40-piano-30.md`
- [x] Leve di costo già fatte: `goal_done` stabile (`extensions/goal.ts`, `goal.test.ts` 18/18), `keepRecentTokens` 10000 (`~/.pi/agent/settings.json`).
- [x] Archivio a due livelli con `richiama` e recupero automatico. — prova: `node --test extensions/archivio.test.ts` 6/6; dump con identificatori: corrette 18/18 contro 1/18 del default a −16,5% di costo (haiku), Sonnet 6/6 contro 0/6 (`eval/ab/REPORT.md`)
- [x] Studio fasi 0–4 e misure di recupero senza identificatori. — prova: `docs/architetto/contesto-secondario-recupero/30-alternative.md`; hit@3 poolato 0,50 (BM25, ibrido) contro 0,78 con riscrittura LLM (`eval/ab/REPORT.md` §3, §5); costo riscrittura ~2.066 pesati (§6)
- [ ] Dopo ≥5 compattazioni, ≥90% delle domande su dati usciti dal contesto vivo riceve risposta corretta, anche senza identificatori (banco con domande vere o più realistiche, giudice indipendente). Oggi 0,78 su 50 domande sintetiche.
- [ ] Costo pesato ≤ default Pi sul carico di sole letture (oggi +2,5% solo tool, +3,8% con recupero automatico) e nessun aumento sul carico con dati non rileggibili; riportato in `eval/REPORT.md` anche se negativo.
- [ ] Iniezioni automatiche sbagliate ≤10% (misurato sul banco; oggi non misurato) e latenza di recupero ≤50 ms per turno (la riscrittura sta fuori dal percorso sincrono).
- [ ] Decisione (fase 5) con falsificatore scritta e approvata dall'utente; implementazione della candidata scelta con test (`node --test extensions/*.test.ts`, tsc) e wiki/README aggiornati.
- [ ] Prova manuale dell'utente nel TUI reale dopo `/custom-reload` (sessione vera, `/compact` e `/resume` compresi).

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
- Pesi reali dell'abbonamento (oggi 0,1/1,25/5 da prezzi API; lettura 0,05 su Sonnet/Opus 5.5 non ricalcolata).
- Se il carico misurato rappresenta le sessioni vere (lunghe, con compattazioni).
- Perché il solo tool `richiama` costa +2,5% sul carico di sole letture.
- Dove far girare la riscrittura delle query (15 s, ~2.000 pesati): background o dentro `richiama`.

## Verifica
```bash
node --test extensions/*.test.ts
node eval/gc-bench.mjs --help
```
