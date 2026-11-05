# test-monitor

Pannello sopra l'editor mentre gira un comando di test: un pallino per test (grigio → verde/rosso), contatori, tempo.

## Aggiungere un runner
Una voce in `RUNNERS` (`runners.ts`), nient'altro:
- `matches(command)`: è il tuo runner?
- `prepare?(command, ctx)`: flag o reporter da aggiungere (e file di supporto da scrivere). Mai se l'utente ha già scelto un reporter.
- `source`: `"output"` (stdout del runner, letto da un `| tee` o dall'output parziale del tool) o `"reporter"` (file scritto da un reporter, `ctx.log`).
- `parse(text)`: `Progress` dai risultati visti finora (usa `collect()` di `progress.ts`).
- `estimate(command, cwd)`: totale stimato (di solito `estimateTotal`).
Aggiungi i test in `extensions/test-monitor.test.ts` con output reale del runner.

Runner: node:test, vitest (`--reporter=verbose`), jest (reporter a file, in coda al comando), pytest (`-v`), Playwright e2e (`--reporter=list`, provato su output vero), Cypress e2e (spec reporter, da formato documentato, non provato con un run vero), `npm|pnpm|yarn|bun test` e `run e2e` (formato riconosciuto dall'output).
Spento con `PI_TEST_MONITOR=0` o `PI_UI_LIVE=0`, e su Windows nativo.

## Altri comandi: viste e monitor
Oltre ai test il pannello segue type check (`tsc`), lint (`eslint`), build (`vite|next|webpack|cargo|go build`, `npm run build`), install (`npm|pnpm|yarn|bun`, `pip`), `git` (clone, fetch, pull, push) e `docker` (build, pull). Questi comandi non vengono mai riscritti: il monitor legge solo l'output parziale del tool (stdout e stderr insieme), quindi il modello riceve lo stesso output e lo stesso costo in token.
- Viste (`views.ts`): `tests` (pallini), `bar` (barra con percentuale, fase e file corrente), `issues` (errori/avvisi, file, problema peggiore), `feed` (fase e pacchetti), `steps` (checklist di fasi). Tre righe, stessa cornice (`panel()` in `render.ts`).
- Aggiungere un monitor: una voce in `MONITORS` (`monitors.ts`) con `matches(command)` (un solo comando semplice), `init` (stato vuoto di una vista) e `update(state, text)` (rilegge tutto il testo: deve essere idempotente). Test in `extensions/test-monitor-monitors.test.ts` con output reale.
- Aggiungere una vista: tipo di stato, renderer, voce in `VIEWS`.
- `git` senza terminale non stampa avanzamento (aggiungere `--progress` sporcherebbe l'output del modello): barra indeterminata con fase e ultima riga; con le percentuali nel testo diventa determinata.

## Output rediretto su file
Con `… vitest run x > /tmp/run.log 2>&1; grep …` il tool non stampa nulla mentre il test gira: il monitor legge il file della redirezione (seguendo i `cd`, mai cancellandolo). Funziona anche con comandi su più righe (i corpi degli heredoc sono ignorati) e con il test lanciato in background `(setsid nohup … > log 2>&1 &)`; `--reporter=verbose` si aggiunge solo alla riga del runner. Non funziona se il percorso usa `$VAR` o `~`. Provato con test e col comando vero preso dalla sessione, non nel TUI.

## Barra dei timeout
Sotto la barra `sleep` compaiono le ultime due righe del file che il comando sta per leggere (`tail`/`cat`) o su cui scrive il processo in background (`> log`), con dimensione e «writing now» / «quiet for»: l'attesa non è più cieca. Aggiornato ogni 500 ms, solo lettura.
`extensions/timeout-bar.ts`: una barra per ogni timeout in corso, sopra l'editor (cyan, giallo dal 75%, rosso dal 90%): parametro `timeout` del tool bash, `timeout N cmd` dentro il comando, agenti del team (20 minuti, via evento `timeout-bar:set` di pi-team). Il timeout dei tool MCP (24 h) non ha barra. `PI_TIMEOUT_BAR=0` la spegne. Provata con test e render, non nel TUI.
