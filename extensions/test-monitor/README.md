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

Runner: node:test, vitest (`--reporter=verbose`), jest (reporter a file, in coda al comando), pytest (`-v`), `npm|pnpm|yarn|bun test` (formato riconosciuto dall'output).
Spento con `PI_TEST_MONITOR=0` o `PI_UI_LIVE=0`, e su Windows nativo.
