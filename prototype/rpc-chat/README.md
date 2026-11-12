# Prototipo: chat da zero sopra `pi --mode rpc`

`node prototype/rpc-chat/chat.mjs [--model haiku]` — un file, nessuna dipendenza, niente `pi-tui`. Avvia `pi --mode rpc` (sessioni salvate) e disegna da sé la chat nel terminale (schermo alternativo).

Cosa fa: prompt (invio), streaming di testo e pensiero, riga per i tool, abort (ctrl+c durante il lavoro), messaggi scritti durante il lavoro inviati come `steer` (il modello li legge dopo i tool in corso, senza fermare il lavoro; il contatore «N in coda» segue `queue_update`), uscita (ctrl+c a riposo, ctrl+d). Disegno differenziale per riga, frame in streaming limitati a `PROTO_FPS` (30), tasti ridisegnati subito, righe a capo dei blocchi chiusi in cache.

Aggiunti per il confronto equo: Markdown (titoli, elenchi, citazioni, blocchi di codice, grassetto/corsivo/codice in linea), a capo consapevole di ANSI, scorrimento (PagUp/PagDown, frecce su/giù, rotellina, End), cursore e modifica nel prompt (frecce, Home/End, Canc, ctrl+a/e/u).

Seconda tappa: caratteri larghi ed emoji (2 colonne), pensiero live (ultime 4 righe, poi una riga «thought · N words»), passi dei tool con ✓/✗ e durata, riga di stato con modello, contesto %, costo e le voci `setStatus` delle estensioni (intent, goal, memoria…), `setWidget` (testo) sopra la riga di stato, `notify` come avviso di 5 s, `setTitle`, incolla tra parentesi (`bracketed paste`, righe multiple), dialog `select`/`confirm`/`input`/`editor` delle estensioni (frecce+invio, y/n, esc). Provato con Pi vero e haiku: `eval/ui/proto-real.py` (tool ✓, stato) e `eval/ui/proto-dialog.py` (il dialog dei comandi pericolosi appare, «No» blocca il comando; serve `PI_YOLO=0`).

Cosa non fa: vedi l'elenco di parità qui sotto.

Variabili solo per misura: `PROTO_CPU=<file>` (CPU di client e processo RPC), `PROTO_DUMP=<file>` (ultimo schermo).
Misure: `eval/ui/REPORT.md`.

Carico fisso per le misure: `prototype/replay/index.ts` (provider che ignora il prompt e trasmette un documento Markdown deterministico, `REPLAY_CPS`/`REPLAY_CHUNK`/`REPLAY_KB`). Uso identico per Pi: `pi -e prototype/replay/index.ts --provider replay --model fixed`.

## Rilevamento immagini
All'avvio il prototipo chiede al terminale una query kitty graphics più DA1; dalla risposta imposta `kitty`, `sixel` o `none` (timeout 1,5 s → `none`), mostrato nel pannello ("immagini: …"). Verificato con risposte simulate nel pty (`/tmp/uiprof/det.py`); non ancora disegna immagini.

## Immagini
`/img percorso [testo]` allega un PNG/JPEG al prompt; le immagini nei risultati dei tool (es. `read` su un PNG) vengono mostrate. Kitty o sixel secondo il rilevamento; JPEG e terminali senza immagini: riga segnaposto. Pesi misurati in `eval/ui/REPORT.md` (sezione Immagini).

## Lotto 1 di funzioni (goal: tutte le funzioni, prestazioni alte, via ciò che è pesante e poco utile)
Aggiunti: suggerimenti 1-4 (blocco `<!--suggerimenti-->`, tasto 1-4 a prompt vuoto), diff colorato dei file per `edit`, link `file:riga` cliccabili (OSC 8, `vscode://file`), campanello a fine turno > 30 s, pensiero apribile (`ctrl+t`), send now (`alt+d` (configurabile con `PI_NOW_KEY`, una lettera), `ctrl+enter`, invia `/now`: porta a `steer` i follow-up rimasti in coda; in RPC pi-ui registra la sessione apposta). Tolto: sixel (decoder PNG + encoder, 2,5 s CPU su un'immagine grossa, ridisegno a ogni scorrimento); restano le immagini kitty.

## Come si lancia
È la UI predefinita: `pi` (funzione di shell di `install.sh`; PowerShell su Windows via `scripts/setup.mjs`) esegue `bin/pi.mjs`, che avvia questa chat. `pi --classic` o `PI_UI_CLASSIC=1` danno la UI classica con `pi-ui` (con `/custom-reload`). Restano classici gli usi non interattivi (`-p`, `--mode`, `--version`, sottocomandi come `install`) e gli stream non TTY. `-d` = `PI_YOLO=1`.

## Parità con la UI classica (`pi-ui`)
Fatto:
- sessioni: `/resume`, `/model [nome]` (selettore o nome parziale, via `set_model` RPC), `/name`, `/new`, nome nella barra; `/compact`; usage 5h/7g nella barra.
- barra di stato (modello, contesto, costo, intent, goal, loop, team, memoria via `setStatus`); monitor dei test e barra timeout/sleep (widget testuali in RPC, `extensions/widget-compat.ts`).
- cockpit di `/auto` (`alt+a` o `/auto` senza argomenti): vista a schermo intero della corsa (`cockpit.mjs`), IN DIRETTA/RIVEDI, guida con `p` `:` `s`, chat col modello con `c` (striscia sopra i tasti; il modello usa il tool `auto`); dati da file + `fs.watch` (percorso via `setStatus("auto-run")`), timer da 1 s solo a vista aperta e corsa attiva. Provata con `pty.py` e Pi finto. In RIVEDI la testata dice «RIVEDI passo k di n» (stretta: «RIVEDI k/n»); `esc` o `fine` torna alla diretta, `esc` in diretta chiude; →/← cambiano passo, riga dei tasti contestuale, «in attesa» al posto dei tasti spenti, timer che ridisegna solo la testata.
- pannello laterale (`alt+s` lo nasconde/mostra; sotto 110 colonne si apre sopra la barra): intent con outcome, goal, piano `todo`, test (ok/falliti e test che falliscono), git, contesto, estensioni.
- passi dei tool con ✓/✗ e durata, diff colorato di `edit`, pensiero (`ctrl+t`), suggerimenti 1-4, link `file:riga`, campanello a fine turno lungo, send now come Claude Code (`alt+d` (configurabile con `PI_NOW_KEY`, una lettera), `ctrl+enter` o `/now`, tutti su `/now` di pi-ui): i comandi bash in corso passano in background e continuano, il tool ritorna subito con l'output finora e il log, il modello legge la coda nello stesso turno e riceve un messaggio quando il comando finisce; se non c'è un bash da spostare (il modello sta scrivendo) interrompe e manda coda + testo dell'editor come prossimo prompt. Provato con haiku: `sleep 40` staccato a 9 s, risposta subito; via RPC `sleep 25` staccato a 15 s, messaggio di fine a 31 s. Senza pi-ui resta l'invio forzato locale (`clear_queue` + `abort`). I messaggi scritti mentre Pi lavora restano in fondo alla chat, attenuati, con «↳ in coda · alt+n invia ora», finché Pi non li passa al modello (`message_start` del messaggio utente); poi prendono il loro posto nella conversazione. `pty.py` ha il passo `snap` (schermo a metà prova, via `SIGUSR1`). `alt+s`/`alt+v` prima non arrivavano (la regex dei tasti riconosceva solo `alt+n`): corretto.
- immagini (kitty): risultati dei tool, `/img`, incolla di un percorso PNG/JPEG o `alt+v` dagli appunti (anteprima 📎 sopra il prompt, `ctrl+u` a prompt vuoto le toglie).
- completamento `/comandi` e `@file`, Markdown, tabelle, grafici, incolla multiriga.
- questionari (`ask_user_question`): una card sola con schede per domanda, caselle ☑ per la scelta multipla, anteprima, risposta libera e pagina «Rivedi»; il client risponde da solo ai dialog `select`/`input` che l'estensione invia in sequenza (se la sequenza non torna, mostra i dialog normali);
- dialog `select`/`confirm`/`input`/`editor`; `/bugreport` come serie di dialog; `/archive [id|testo]` come testo in un pager.
- grafica: messaggi di Pi con barra `▍` e aria tra i turni; passi dei tool come schede sottili (barra di stato a sinistra, durata a destra); toast animato in alto al centro con livelli (`SEV`); cornice solo sul prompt; blocchi di codice con etichetta del linguaggio; barra di stato a voci con priorità (toglie le meno importanti quando è stretta).
- pannello destro adattivo (36/34/28 colonne, nascosto sotto 100; `alt+s`): INTENT, GOAL, PIANO, TEST, ATTIVITÀ (barre dei timer `▰▱` con etichetta a sinistra e orologio a destra), GIT, CONTEXT, USO (5h/7g), MEMORIA, ESTENSIONI, log del team (`team-log`).
- `/custom-reload` (riavvia il processo Pi tenendo la sessione), `/no-permissions`, `ctrl+v`/`alt+v` per immagini e testo dagli appunti, messaggi in coda («N in coda»), badge consigli (max 3).
- animazioni con un solo orologio (125 ms) solo durante un turno; `PROTO_ANIM=0` le spegne; 15 fps in streaming.
- se Pi muore, il motivo finisce in `~/.pi/agent/proto-last-exit.log`.

Scartato, con motivo:
- animazioni di intro, effetti, miniature con worker: pesanti, poca utilità (obiettivo CPU ≤ 1/4).
- sixel: 2,5 s di CPU su un'immagine grossa.
- `alt+a` (picker modale) e `/pick`: sostituiti dal completamento `@file`.
- colonna browser, widget voce: componenti `custom()`, inesistenti in RPC; restano gli stati testuali.
- `alt+b` per `/bugreport`: usa il comando.
- notifica toast di Windows: resta il campanello.
- `/archive` a schermo intero con ricerca interattiva: `custom()` assente in RPC; sostituito da riepilogo e ricerca testuale.
- pannello float (`PI_UI_PANEL=float`): il pannello è fisso.

## Prove e prestazioni
- `node --test --test-concurrency=2 prototype/rpc-chat/perf.test.mjs`: 23 test e budget in µs per funzione (`PERF_VERBOSE=1` stampa i tempi); il banco `perf-harness.mjs` esegue il corpo di `chat.mjs`.
- `python3 -I prototype/rpc-chat/pty.py [--fake eventi.jsonl] [--cols N] PASSO… -- [args]`: prova nel pty con `fake/pi` (passi: testo, `key:down|up|enter|esc|tab`, `sleep:S`).
- `node scripts/t.mjs [nome…]`: lancia solo i test dei file modificati.
- Misure su Proxmox (CPU, replay): `eval/ui/REPORT.md`.
