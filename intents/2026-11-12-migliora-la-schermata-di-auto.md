---
status: done
created: 2026-11-12
source: auto
---

# Migliora la schermata di auto

## Problema
La schermata di `/auto` è la vista a schermo intero (cockpit) del prototipo (`prototype/rpc-chat/cockpit.mjs`, `chat.mjs`), alimentata da stato JSON e diario (`extensions/auto/diary.ts`). Il primo lotto la rende usabile, ma restano punti deboli: per rispondere a «sta procedendo? perché?» serve ancora leggere più zone; il passo corrente è testo grezzo; il layout non è verificato su larghezze strette e su corse lunghe; le prestazioni con vista aperta non sono misurate; la guida è minima (pausa, nota, stop). Interpretazione adottata: «schermata di auto» = cockpit di `/auto`, non il pannello laterale classico.

## Outcome atteso
- [ ] La testata mostra in una sola riga fase, passo, salute con motivo, tempo e «fermo da Ns»; la risposta a «sta procedendo? perché?» si legge senza scorrere né cambiare modo. — prova: test righe in `extensions/auto-cockpit.test.ts` e `pty.py` a 110×30.
- [ ] Elenco requisiti: stato per riga (verde, in corso, rosso, da fare) con conteggio `n/m`, il requisito in corso evidenziato; con molti requisiti l'elenco scorre e mantiene visibile quello corrente. — prova: test con 3 e con 40 requisiti.
- [ ] Il passo corrente in diretta mostra gli ultimi tool (nome + argomento breve) e il testo finale a capo pulito, senza tagli a metà parola né righe oltre la larghezza. — prova: test `wrapPlain` e righe a 60, 80, 110 colonne.
- [ ] Layout adattivo: a larghezze strette (<70) i blocchi si impilano e perdono solo i dettagli secondari; mai righe più larghe del terminale né sfarfallio su resize. — prova: test righe a più larghezze + pty con `--cols`.
- [ ] Modo RIVEDI più chiaro: indicazione del passo «k di n», esito, durata e token del passo; `esc` o `→` oltre l'ultimo torna IN DIRETTA. — prova: pty con ←/→/esc.
- [ ] Stati vuoti e anomali gestiti: nessuna corsa, corsa finita, diario assente o con riga troncata, stato illeggibile; messaggio in italiano con il prossimo tasto utile. — prova: test su ciascun caso.
- [ ] Riga dei tasti contestuale (solo quelli validi nello stato: pausa↔riprendi, nota, stop, RIVEDI), con «in attesa: …» per i comandi non ancora applicati. — prova: test `nextKey` per stato.
- [ ] Nessuna regressione di costo: 0 token per la vista, niente lavoro per frame, unico timer da 1 s solo con vista aperta e corsa attiva, ridisegna solo la testata. — prova: test sul timer e sul feed.
- [ ] Prestazioni: CPU del prototipo con vista aperta e corsa attiva non peggiora oltre il 10% rispetto alla misura attuale; risultato (anche negativo) in `eval/ui/REPORT.md`. — prova: `prototype/rpc-chat/perf.test.mjs`, 5 giri alternati, mediana.
- [ ] Documentazione aggiornata: `prototype/rpc-chat/README.md`, sezione `/auto` del README, `vault/wiki/entities/chat-rpc.md` e `vault/wiki/log.md`. — prova: diff.

## Vincoli
- Solo prototipo; la UI classica (riga di stato, notifiche, `/auto status`) non cambia.
- Nessuna dipendenza nuova; niente lavoro per frame; grafica sobria; UI in italiano, commenti nel codice in inglese.
- Supervisore nella sessione Pi (ADR 0001); i check congelati non cambiano; la corsa non si ferma ad aspettare l'utente; mai push né merge.
- `alt+s` non si riassegna; `alt+a` resta l'apertura della vista.
- Fuori scope: nuove funzioni di guida (saltare/riordinare requisiti, modello per passo, presa in mano), già rimandate dall'intent «Cockpit di auto mode».

## Domande aperte
- Quale schermata si intende? — Ipotesi: il cockpit a schermo intero di `/auto`, perché è l'unica vista dedicata.
- Il miglioramento è visivo o funzionale? — Ipotesi: prevalentemente leggibilità e robustezza del layout, senza nuove azioni di guida.
- Soglia di prestazioni accettabile? — Ipotesi: non peggiorare oltre il 10% la misura attuale, perché il limite 1/4 di Pi resta dell'intent del cockpit.
- Serve una prova dell'utente nel TUI reale? — Ipotesi: sì, ma non blocca la chiusura; resta nell'intent del cockpit.

## Verifica
- `node scripts/t.mjs auto-cockpit auto` e, a fine lotto, `node --test extensions/*.test.ts`.
- `cd pi-claude-code && npx tsc -p .` e `cd pi-ui && npx tsc -p .` puliti.
- `python3 -I prototype/rpc-chat/pty.py --fake <eventi.jsonl> --cols 60|80|110 …` per IN DIRETTA, RIVEDI, stati vuoti.
- `prototype/rpc-chat/perf.test.mjs` con report in `eval/ui/REPORT.md`.

## Esito auto mode
- Arresto: completato — 10/10 requisiti verdi
- Passi: 14 · token: 3328606 · durata: 11 min · branch `auto/migliora-la-schermata-di-auto`
- [x] R1: Testata a una riga: fase (dal diario, mai «undefined»), passo, salute con motivo, tempo e «fermo da Ns», anche a 60 colonne — check: `node --test --test-name-pattern "^R1:" extensions/auto-cockpit-v2.test.ts`
- [x] R2: Elenco requisiti con n/m, stato per riga (✓ ▸ ✖ ○) e scorrimento che tiene visibile il requisito in corso con 40 requisiti — check: `node --test --test-name-pattern "^R2:" extensions/auto-cockpit-v2.test.ts`
- [x] R3: Passo in diretta: ultimi tool (nome + argomento) e testo finale a capo pulito, senza parole spezzate né righe oltre la larghezza — check: `node --test --test-name-pattern "^R3:" extensions/auto-cockpit-v2.test.ts`
- [x] R4: Layout adattivo: sotto 70 colonne blocchi impilati, da 80 in colonne, mai righe oltre il terminale, output deterministico — check: `node --test --test-name-pattern "^R4:" extensions/auto-cockpit-v2.test.ts`
- [x] R5: RIVEDI: «passo k di n», esito, durata, token; esc o → oltre l'ultimo torna IN DIRETTA (navigate esportata e usata da chat.mjs) — check: `node --test --test-name-pattern "^R5:" extensions/auto-cockpit-v2.test.ts`
- [x] R6: Stati vuoti e anomali: nessuna corsa, stato illeggibile (feed.problem), diario assente, corsa finita; messaggio in italiano col tasto utile — check: `node --test --test-name-pattern "^R6:" extensions/auto-cockpit-v2.test.ts`
- [x] R7: Riga dei tasti contestuale (keyHints esportata): solo tasti validi nello stato, «in attesa: …» accanto ai tasti, p riprendi↔pausa — check: `node --test --test-name-pattern "^R7:" extensions/auto-cockpit-v2.test.ts`
- [x] R8: Costo: cockpitHead esportata, il timer da 1 s ridisegna solo la testata se nient'altro cambia, un solo setInterval, cockpit.mjs senza timer né chiamate al modello — check: `node --test --test-name-pattern "^R8:" extensions/auto-cockpit-v2.test.ts`
- [x] R9: Prestazioni: misura di base e dopo, 5 giri alternati con mediana, entro +10% o risultato negativo dichiarato in eval/ui/REPORT.md — check: `node --test --test-name-pattern "^R9:" extensions/auto-cockpit-docs.test.ts`
- [x] R10: Documentazione: README del prototipo, README, chat-rpc.md e log.md descrivono RIVEDI «k di n», esc e il lavoro fatto — check: `node --test --test-name-pattern "^R10:" extensions/auto-cockpit-docs.test.ts`
- Decisioni: `auto/decisioni.md` · da approvare: `auto/da-approvare.md`
- Skill: date spec-driven-development×2, frontend-ui-engineering×10, planning-and-task-breakdown×1, doubt-driven-development×1, incremental-implementation×10, security-and-hardening×2, code-review-and-quality×1 · lette nessuna
- Strumenti: dati search×12, graph×12, browser×11, lancia×11 · usati nessuna
