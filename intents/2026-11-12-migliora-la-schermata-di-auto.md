---
status: in-progress
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
