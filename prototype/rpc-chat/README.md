# Prototipo: chat da zero sopra `pi --mode rpc`

`node prototype/rpc-chat/chat.mjs [--model haiku]` — un file, nessuna dipendenza, niente `pi-tui`. Avvia `pi --mode rpc --no-session` e disegna da sé la chat nel terminale (schermo alternativo).

Cosa fa: prompt (invio), streaming di testo e pensiero, riga per i tool, abort (ctrl+c durante il lavoro), prompt in coda con `followUp`, uscita (ctrl+c a riposo, ctrl+d). Disegno differenziale per riga, frame in streaming limitati a `PROTO_FPS` (30), tasti ridisegnati subito, righe a capo dei blocchi chiusi in cache.

Aggiunti per il confronto equo: Markdown (titoli, elenchi, citazioni, blocchi di codice, grassetto/corsivo/codice in linea), a capo consapevole di ANSI, scorrimento (PagUp/PagDown, frecce su/giù, rotellina, End), cursore e modifica nel prompt (frecce, Home/End, Canc, ctrl+a/e/u).

Cosa NON fa: caratteri larghi/IME (ogni carattere conta 1 colonna), immagini, selezione/copia dedicata, pannello, barra di stato dei progetti, passi compatti, estensioni UI (`custom`, `setFooter`, `setWidget` con componenti sono no-op in RPC), dialog `extension_ui_request`.

Variabili solo per misura: `PROTO_CPU=<file>` (CPU di client e processo RPC), `PROTO_DUMP=<file>` (ultimo schermo).
Misure: `eval/ui/REPORT.md`.

Carico fisso per le misure: `prototype/replay/index.ts` (provider che ignora il prompt e trasmette un documento Markdown deterministico, `REPLAY_CPS`/`REPLAY_CHUNK`/`REPLAY_KB`). Uso identico per Pi: `pi -e prototype/replay/index.ts --provider replay --model fixed`.
