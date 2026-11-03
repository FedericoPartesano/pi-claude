---
status: in-progress
created: 2026-11-03
source: user
---

# Monitor dei test in estensione a parte, con supporto nativo a jest e vitest

## Problema
Il monitor dei test in diretta (pallini grigi → verdi/rossi, contatori, tempo) vive dentro `pi-ui` ed è tarato su `node --test`. Con jest e vitest veri (jest 30, vitest 5.1, output su pipe) non funziona: jest non stampa nulla per test, nemmeno con `--verbose`, solo il riepilogo finale; vitest stampa una riga per test solo con `--reporter=verbose`. Serve un'estensione dedicata, con un adattatore per runner, che renda il supporto a jest e vitest nativo e mirato e permetta di aggiungerne altri (pytest, go, cargo…) uno alla volta.

## Outcome atteso
- [x] Estensione `extensions/test-monitor.ts` (+ moduli sotto `extensions/test-monitor/`) registrata in `package.json`, con il monitor, il `tee` e la stima del totale spostati fuori da `pi-ui`; `pi-ui` non contiene più `test-monitor.ts` e `test-progress.ts`. — prova: node --test extensions/test-monitor.test.ts → 14 pass; package.json pi.extensions contiene ./extensions/test-monitor.ts; widget, tee e stima nell'estensione, rimossi da pi-ui/index.ts
- [x] Interfaccia a adattatori per runner (riconoscimento del comando, riscrittura del comando, lettura dell'avanzamento, stima del totale), con node:test come primo adattatore: comportamento invariato rispetto a oggi. — prova: extensions/test-monitor/runners.ts (RUNNERS: node:test, vitest, jest, pytest, script); test detectRunner/prepare verdi; extensions/test-monitor/README.md
- [x] Adattatore vitest: il comando riceve `--reporter=verbose` se manca un reporter, l'avanzamento si legge in diretta, il totale si stima dai file; provato con vitest vero in una cartella temporanea. — prova: /tmp/e2e.mjs con vitest 5.1 vero: comando riscritto con --reporter=verbose, pallini 0/3→1/3→2/3, FAILED con v3; il modello riceve il riepilogo di vitest
- [x] Adattatore jest: avanzamento in diretta per test tramite un reporter/output leggibile mentre gira (provato con jest vero), senza rompere l'output filtrato che riceve il modello; totale stimato (anche `it.each`, `describe.each` non sottostimati oltre il possibile: il totale cresce se serve). — prova: /tmp/e2e.mjs con jest 30 vero: reporter a file in coda al comando, 0/5→4/5 in diretta, FAILED con s3; il modello riceve "Tests: 1 failed, 4 passed, 5 total"
- [x] Il modello riceve lo stesso output filtrato di prima (`| tail`, `| grep`) con tutti i runner; il comando non viene riscritto se ha già un reporter scelto dall'utente o in casi ambigui. — prova: e2e con node/jest/vitest: output di tail invariato; test "user choices are left alone" (--reporter, --json, già con tee) verde
- [x] Il monitor non compare per comandi non di test, su Windows nativo, o con `PI_UI_LIVE=0`; il file temporaneo si cancella sempre. — prova: test "extension: rewrites… cleans up" verdi (log e helper rimossi, ls | tail intatto); guardia win32/PI_UI_LIVE=0 nel codice
- [x] Test automatici dell'estensione (adattatori, parser, riscrittura, stima, render) verdi, `node --test pi-ui/test/*.test.ts` verde, `npx tsc --noEmit -p pi-ui` senza errori e typecheck dell'estensione. — prova: 168 test pi-ui + 14 test extensions/test-monitor.test.ts verdi; npx tsc --noEmit -p pi-ui pulito; typecheck dell'estensione: nessun tsconfig copre extensions/ (pi-coding-agent non risolvibile fuori da Pi), eseguita tsc su test-monitor/*.ts senza errori di tipo propri
- [x] Prova con runner veri (node --test, jest, vitest) in cartella temporanea: dall'output reale il monitor mostra pallini e contatori corretti e il risultato finale coincide con il riepilogo del runner. — prova: /tmp/e2e.mjs con node --test, jest 30, vitest 5.1 veri: conteggi finali (node 3 ok·1 ko (dopo fix del doppio conteggio nella lista finale); jest 4 ok·1 ko; vitest 2 ok·1 ko) = riepilogo del runner
- [x] Documentato come aggiungere un nuovo runner (README/vault) e aggiornati vault/wiki (index, log) se pertinente. — prova: vault/wiki/log.md voce 2026-11-03, sezione in vault/wiki/entities/pi-ui.md, extensions/test-monitor/README.md
- [ ] Provato nel TUI reale dopo `/custom-reload` (monitor visibile con jest e vitest): prova manuale dell'utente.

## Utenti e sistemi impattati
- Utente di Pi che lancia test: vede avanzamento reale senza invadere la chat.
- `pi-ui` (widget `pi-ui-tests`, hook `tool_call`/`tool_execution_*`), `package.json` (`pi.extensions`), vault/wiki.
- Modello: riceve solo l'output che ha chiesto; nessun token extra.

## Vincoli
- Nessun commit/push senza richiesta esplicita.
- Nessuna dipendenza nuova nel repo: jest e vitest solo in `/tmp/runners/proj` per le prove.
- Funziona su Linux, macOS e WSL; su Windows nativo il monitor resta spento.
- Pi non segue i symlink negli import relativi: percorsi reali.
- Aggiornare i test insieme al codice; comandi interattivi del TUI li prova l'utente.
- Commenti nel codice in inglese; testo dell'interfaccia del monitor in inglese.

## Domande aperte
- Altri runner (pytest, go, cargo, mocha, bun test): per ora solo la struttura a adattatori, uno alla volta in seguito.
- `npm test` senza file: totale non stimabile senza leggere lo script; da valutare dopo.

## Verifica
```bash
node --test extensions/test-monitor.test.ts
node --test pi-ui/test/*.test.ts
npx tsc --noEmit -p pi-ui
cd /tmp/runners/proj && npx jest --reporter=default src/b.test.js && npx vitest run --reporter=verbose src/v.test.mjs
```
