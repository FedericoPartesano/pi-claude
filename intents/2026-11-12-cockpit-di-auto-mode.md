---
status: in-progress
created: 2026-11-12
source: user
---

# Cockpit di auto mode: vista a schermo intero per seguire e guidare una corsa /auto

## Problema
`/auto` porta un goal da solo attraverso define → docs → plan → build → review → ship, ma lo si segue solo da una riga di stato, dal pannello laterale e da `/auto status`; la guida si riduce a `/auto stop`. Per capire una corsa bisogna aprire il JSON di stato, `auto/decisioni.md`, l'intent e `git log`. Studio completo in `docs/architetto/auto-mode-cockpit/` (brief, territorio, ricerca, ignoto).

## Outcome atteso
Primo lotto (vista + diario + guida minima). Il resto del brief è nella sezione «Fuori da questo lotto».
- [x] Diario compatto `<repo>-auto/<slug>.eventi.jsonl`: per passo avvio, tool (nome, argomento breve), fine (esito, durata, token, testo finale), esito dei check (con coda dell'output se rossi), comandi di guida. Output tagliati; riga finale senza `\n` ignorata in lettura. — prova: `extensions/auto-cockpit.test.ts` (diario, riga troncata), 10/10 verdi; corsa reale con figlio finto: eventi step/cmd/end scritti
- [x] Salute in una parola con motivo (PROCEDE, A RISCHIO, FERMA, SERVE TE) con le soglie del brief (stallo 2/3, stesso errore ≥3, budget o tempo ≥80%, 4 passi build di fila senza un requisito verde). — prova: test `health` in auto-cockpit.test.ts
- [x] Vista a schermo intero nel prototipo (`prototype/rpc-chat/cockpit.mjs` + `chat.mjs`), aperta da `alt+a` o da `/auto` senza argomenti durante una corsa: testata (fase, passo, salute+motivo, tempo, 5h, «fermo da Ns»), requisiti con stato, passo corrente in diretta, riga del prossimo tasto, tasti. Modi IN DIRETTA e RIVEDI (←/→ passi passati). — prova: `pty.py` con Pi finto, 110×30: IN DIRETTA e RIVEDI con ←
- [x] Guida: `p` pausa/riprendi, `:` nota al prossimo passo, `s` stop; anche da riga di comando `/auto pausa|riprendi|nota <testo>`. Ogni comando in `auto/decisioni.md` e nel diario; la vista mostra «in attesa: …» finché non è applicato. — prova: pty invia `/auto nota|pausa|stop`; corsa reale con `pi --mode rpc`: pausa/nota/riprendi applicati, righe in `auto/decisioni.md` e nel diario
- [x] Canale dati: il client legge stato JSON e diario dai file, risvegliato da `fs.watch`; il percorso arriva con `setStatus`. Nessun traffico RPC per i dati. — prova: `setStatus auto-run` visto in RPC reale; vista aperta via fs.watch+feed (test `feed`)
- [x] Test automatici: diario, salute, vista (righe a 100×30 e a larghezze strette), pausa/nota nel loop; tsc pulito; suite estensioni verde. — prova: tsc pulito (pi-claude-code e pi-ui), `node --test extensions/*.test.ts` 366 pass, 0 fail
- [x] 0 token per la vista; la nota dell'utente è l'unico testo aggiunto a un prompt, solo se esiste. — prova: vista e feed senza chiamate al modello; `withNotes` aggiunge testo solo se ci sono note (test)
- [ ] Prestazioni: sul Proxmox, CPU del prototipo ≤ 1/4 di Pi con `pi-ui`, anche con vista aperta e corsa attiva (carico replay), 5 giri alternati, mediana, in `eval/ui/REPORT.md` anche se negativo.
- [ ] Prova d'uso dell'utente nel TUI reale con una corsa vera: «sta procedendo? perché?» in ≤5 s.
- [x] README (`prototype/rpc-chat/README.md`, sezione `/auto` del README) e wiki aggiornati. — prova: README.md, prototype/rpc-chat/README.md, vault/wiki/entities/chat-rpc.md e log aggiornati

## Fuori da questo lotto (intent successivo)
Saltare/riordinare/riaprire requisiti, modello per passo, forzare skill e strumenti, rifai passo con nota, limiti, steer urgente `!`, presa in mano manuale (`c`/`r`), tab diff e dettaglio tool/testo del figlio, coda «serve te» con campanello, lacune del loop (`auto/appunti.md`, scarto dei tentativi rossi, rilevazione di aggiramento, `auto/regole.md`).

## Vincoli
- Solo prototipo; nella UI classica restano riga di stato, notifiche e `/auto status`.
- Nessuna dipendenza nuova; niente lavoro per frame; unico timer da 1 s solo con vista aperta e corsa attiva, ridisegna solo la testata.
- Supervisore nella sessione Pi (ADR 0001); i check congelati non cambiano mai; la corsa non si ferma ad aspettare l'utente; mai push né merge.
- Nessun commit/push senza richiesta esplicita. `alt+s` non si riassegna. Grafica sobria.
- Commenti nel codice in inglese, UI in italiano.
