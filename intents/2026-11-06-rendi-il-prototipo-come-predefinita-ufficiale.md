---
status: in-progress
created: 2026-11-06
source: user
---

# Rendere il prototipo la UI predefinita ufficiale

## Problema
La UI di Pi (`pi-ui` dentro il TUI) è lenta e goffa nel terminale dell'utente (WSL, `noctty`): sul carico di sola scrittura costa ≈4,3× la CPU del prototipo `prototype/rpc-chat/chat.mjs` (frontend su RPC, `eval/ui/REPORT.md`). Il prototipo è veloce ma incompleto: mancano sessioni (`/resume`, nome; oggi `--no-session`), barra di stato completa (usage 5h/7g, goal, loop, team, animazioni), pannello sessione con goal e todo, viste a schermo intero (`/archivio`, `/bug`, anteprima immagini incollate, output dei test). Va completato e reso la UI predefinita, mantenendo la CPU a ≤1/4 di quella attuale di Pi con `pi-ui`.

## Outcome atteso
- [x] Sessioni nel prototipo: parte senza `--no-session`, `/resume` elenca e riprende sessioni, nome sessione visibile e modificabile. — prova: `/tmp/sess.py` (pty): turno + `/name`, nuova istanza, `/resume` + Invio ricarica «▌ ciao uno» e la risposta (dump); fix della corsa switch→get_messages; barra mostra il nome (non guardato a occhio dopo il resume)
- [ ] (parziale: usage 5h/7g visto nel dump pty; barra timeout/sleep ora arriva in RPC come widget testuale, verificato con `pi --mode rpc` + haiku: eventi `setWidget` `timeout-bar` con la barra; stessa funzione `extensions/widget-compat.ts` (test 2/2) per il monitor test, non ancora visto dal vivo; `/loop` ora accettato in modalità rpc; restano goal/intent/team da vedere nel prototipo) Barra di stato completa: modello, contesto, usage 5h/7g, goal/loop/team/intent attivo, monitor test, barra timeout/sleep.
- [ ] (parziale: pannello con sezioni INTENT con conteggio outcome, GOAL da status, PIANO da todo; `alt+s` lo nasconde/mostra, su terminali stretti lo apre sopra la barra; visti nel pty: «PIANO 1/3» da sessione ripresa con todo, «INTENT … outcome» nel repo; GOAL non ancora visto con un goal vero) Pannello sessione con goal e todo (equivalente di `alt+s`, che non va riassegnato).
- [ ] (parziale: `/bugreport` in RPC come sequenza di dialog input/select/confirm, visti nel pty «Bug: titolo» → «Cosa è successo»; `/archivio` in RPC come testo (`archiveText`, `/archivio <id>`, `/archivio <testo>`) mostrato dal pager del prototipo (notify ≥4 righe, ↑↓/PgUp/PgDn/q); test archivio+bug 11/11; pager e `/archivio` non ancora visti dal vivo; anteprima immagini incollate (percorso incollato, visto nel pty «foto.png … KB … invio le manda»; `alt+v` dagli appunti non provato) e output test nel pannello (visto nel pty con bash vero: «TEST ok · falliti») fatti) Viste: `/archivio`, `/bug`, anteprima immagini incollate, output dei test, risposte a dialog di estensioni (select/confirm/input/editor).
- [ ] (elenco scritto in `prototype/rpc-chat/README.md` con fatto/scartato e motivo; da rileggere contro `pi-ui` voce per voce) Tutte le altre funzioni dell'UI attuale presenti o scartate con motivo scritto (elenco di parità in `prototype/rpc-chat/README.md`, ogni voce fatta/scartata).
- [ ] (parziale: lotto 2 misurato — testo 8,36 s mediana vs Pi 35,4 s (4,23×, soglia 8,85 s), ricco 5,19 s vs 40,2 s (7,7×); in `eval/ui/REPORT.md` «Lotto 2», dati in `eval/ui/pve/lotto2/`; vale per i lotti fatti finora, da rifare se si aggiunge altro) Prestazioni: dopo ogni lotto, sul Proxmox (LXC `301`, `eval/ui/pve/`), CPU del prototipo ≤ 1/4 di Pi con `pi-ui` (≤8,6 s su 34,6 s di testo; ≤10,1 s sul carico ricco), 5 giri alternati con mediana, riportato in `eval/ui/REPORT.md` anche se negativo.
- [ ] (parziale: `bin/pi.mjs` + funzione shell + blocco PowerShell in `scripts/setup.mjs`; pty: `node bin/pi.mjs --model haiku` apre il prototipo, `--classic` la UI classica; test `bin/pi.test.mjs` 3/3 e `setup.test.mjs` 7/7; macOS e Windows non provati) Il prototipo è il default ufficiale: `pi` (o il comando di installazione, `install.sh`) lancia il frontend nuovo; l'UI attuale resta disponibile con un'opzione; funziona su Linux, macOS, WSL, Windows.
- [x] Test automatici delle parti nuove — prova: `bin/pi.test.mjs` 3/3, `scripts/setup.test.mjs` 7/7, `extensions/widget-compat.test.ts` 2/2, `archivio.test.ts` 12/12 (`archiveText`); estensioni 315/315, `pi-ui` 178/178, `npx tsc --noEmit -p pi-ui` pulito (nessun test automatico per `chat.mjs` stesso: provato via pty). Test automatici delle parti nuove, suite estensioni e `pi-ui` verdi, `npx tsc --noEmit -p pi-ui` pulito.
- [x] README e wiki aggiornati — prova: `README.md` sezione «Chat predefinita», `prototype/rpc-chat/README.md` (come si lancia, parità, misure), `vault/wiki/entities/chat-rpc.md`, index e log. README e wiki aggiornati (come si lancia, come tornare all'UI vecchia, parità funzionale, misure).
- [ ] Prova manuale dell'utente nel TUI reale (WSL `noctty`) con sessione vera, `/resume` e `/compact` compresi.

## Utenti e sistemi impattati
Utente (terminale WSL, anche Windows e macOS); `prototype/rpc-chat/`, `pi-ui/`, `install.sh`, estensioni che usano `ctx.ui` (in RPC `custom()`, `setFooter`, `setHeader`, `setEditorComponent` sono no-op), pannello, monitor test, team, goal.

## Vincoli
- Ogni rifinitura grafica o funzione si progetta prima per le prestazioni: stringhe statiche nei blocchi in cache, niente lavoro per frame, niente timer o animazioni. Dopo ogni lotto si rimisura sul Proxmox; se il margine sfora si toglie la rifinitura (priorità dell'utente, 2026-11-06).
- Nessun commit/push senza richiesta esplicita; la versione la gestisce release-please.
- Nessuna dipendenza nuova (prototipo a zero dipendenze).
- CPU ≤ 1/4 di Pi con `pi-ui`, misurata sul Proxmox con carichi replay (testo e ricco), mai dedotta.
- Pi non lancia comandi interattivi; le estensioni non importano `@earendil-works/pi-tui`; non assegnare `alt+s`.
- UI del pensiero e del monitor in inglese, il resto in italiano; commenti nel codice in inglese, documenti in italiano.
- Costo fisso di prompt minimo; nessuno spegnimento di funzioni come scorciatoia.
- Le prove nel TUI le fa l'utente; le VM `rc-*` del Proxmox non sono mie.

## Domande aperte
- Come far parlare in RPC le viste che oggi usano `custom()` (`/archivio`, `/bug`, pannello): estensione dedicata o vista nel client.
- Il costo delle funzioni mancanti lascerà il margine (oggi ≈7% sul testo)?
- Immagini: solo kitty (sixel tolto); terminali senza kitty restano con segnaposto.

## Verifica
```bash
node --test --test-concurrency=2 extensions/*.test.ts
node --test --test-concurrency=2 pi-ui/test/*.test.ts
npx tsc --noEmit -p pi-ui
# misure sul Proxmox (LXC 301): 5 giri alternati proto / pi-ui / PI_UI=off
bash eval/ui/pve/pb.sh            # carico di testo
bash eval/ui/pve/rich/pr.sh       # carico ricco
```
