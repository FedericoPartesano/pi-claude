---
status: in-progress
created: 2026-11-04
source: user
---

# Recupero della storia compattata ≥90% senza identificatori, a costo ≤ default

## Problema
Dopo una compattazione Pi perde i dettagli dal contesto vivo; l'archivio (`extensions/archivio.ts`, tool `richiama` e recupero automatico) li tiene consultabili ma recupera bene solo se la domanda contiene identificatori. Misure del 2026-11-04 (`eval/ab/REPORT.md`): hit@3 poolato circa 0,5 con BM25/ibrido, 0,78 con riscrittura LLM delle query; la riscrittura costa ~2.066 token pesati e ~15 s; il solo tool costa +2,5% sul carico di sole letture. Obiettivo: ≥90% di risposte corrette dopo ≥5 compattazioni, anche senza identificatori, a costo pesato ≤ default Pi. Studio: `docs/architetto/contesto-secondario-recupero/`.

## Outcome atteso
- [x] Banco con domande vere e giudice indipendente dal generatore, riproducibile in `eval/`. — prova: `eval/archivio/real-questions.mjs` + `real-rank.mjs` + `retrieval-bench.mjs judge` (JUDGE_MODEL=sonnet): 24 domande vere, hit@3 BM25 0,79, ibrido 0,75, riscrittura 0,79 (`eval/ab/REPORT.md` §7)
- [x] — prova: `eval/ab/REPORT.md` §12, B semantico z≥3,7: 36/36, 35/36, 36/36, 30/36 su serie da 12 domande × 3 run (≥90% in 4 serie su 5), ≥9 compattazioni per run, senza identificatori; lessicale 28%, A 64%. Resta alta la varianza. Misura su sessioni con ≥5 compattazioni: risposte corrette ≥90% su dati usciti dal contesto vivo, senza identificatori nella domanda (end-to-end con Pi, non solo retrieval), riportata in `eval/ab/REPORT.md` o `eval/REPORT.md` anche se negativa.
- [ ] (misurato col codice nuovo: sole letture B +1,7% su A, sopra il rumore, REPORT §15; noid +0,4%; dump −16,5%; causa indagata §16: tool `richiama` attivato alla compattazione rompe la cache, ≈+8.800 pesati una tantum per sessione, 63%; resto iniezioni, non isolato) Costo pesato (pesi 0,1/1,25/5) ≤ default Pi sul carico di sole letture (oggi +2,5% solo tool, +3,8% con recupero automatico) e senza aumento sul carico con dati non rileggibili; causa del +2,5% indagata.
- [ ] (quasi: iniezioni sbagliate 3/24 = 12,5% a z≥4,2, §13, obiettivo ≤10% non raggiunto; latenza misurata §14: mediana ≈29 ms, p95 ≈50 ms) (parziale: filtro `repeatedCommand`, iniezioni 20→5 per run, B +2,0% contro +3,8%, §8) Iniezioni automatiche sbagliate ≤10% misurate sul banco; latenza di recupero ≤50 ms nel percorso del turno (la riscrittura fuori dal percorso sincrono).
- [x] — prova: D' confermata dall'utente («Conferma D'», 2026-11-05); falsificatore in `30-alternative.md` (controllo 6); misure §11–12. Decisione (fase 5 dello studio) con falsificatore scritta e approvata dall'utente prima di implementare.
- [ ] (fatto: codice, 9 test archivio, suite 302/302, tsc pi-ui pulito; manca README/wiki) Implementazione con test (`node --test extensions/archivio*.test.ts` e suite estensioni), typecheck e wiki/README aggiornati.
- [ ] Prova manuale dell'utente nel TUI reale dopo `/custom-reload` (sessione vera, `/compact` e `/resume` compresi).

## Utenti e sistemi impattati
Utente di Pi con modelli Claude via bridge `pi-claude-code`; estensione `extensions/archivio.ts`, embedder locale `pi-memory/src/embed.ts`, banco `eval/ab/` e `eval/archivio/`, impostazioni di compattazione.

## Vincoli
- Nessun commit/push senza richiesta esplicita.
- Nessuna dipendenza nuova (embedder locale ammesso).
- Linux, macOS, WSL, Windows; commenti in inglese, documenti in italiano.
- Iniezione ≤1500 caratteri per turno; estratto marcato come dato citato; vince la voce più recente.
- Costo fisso di prompt minimo; tool extra spenti finché non servono; non riscrivere il contesto già inviato.
- Ogni affermazione su prestazioni misurata e riportata in `eval/`, anche se negativa.
- Pi non segue i symlink negli import relativi; non importare `pi-tui` dalle estensioni.
- Le prove nel TUI le fa l'utente; la decisione tra candidate è dell'utente.

## Domande aperte
- Pesi reali dell'abbonamento (lettura 0,05 su Sonnet/Opus 5.5 non ricalcolata).
- Dove far girare la riscrittura (background o dentro `richiama`) e quante ricerche scattano in sessioni vere.
- Perché il solo tool costa +2,5%.
- Rischio di istruzioni piantate in vecchi output richiamati.

## Verifica
```bash
node --test extensions/archivio.test.ts
node --test --test-concurrency=2 extensions/*.test.ts
node eval/archivio/retrieval-bench.mjs judge eval/archivio/rewrite-ranks.json
```
