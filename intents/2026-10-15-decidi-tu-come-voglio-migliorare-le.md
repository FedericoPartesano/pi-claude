---
status: in-progress
created: 2026-10-15
source: user
---

# Prestazioni e risparmio risorse di almeno il 30%

## Problema
Un `pi` a riposo usa fino al 12% di CPU e circa 1 GB di RAM (sessione di 2h50). Ogni sessione tiene vivi processi `claude -p` (~250 MB ciascuno) e vari timer di ridisegno della TUI girano anche senza nulla da mostrare. L'utente vuole un miglioramento di almeno il 30% in prestazioni e consumo di risorse, scegliendo io come.

## Outcome atteso
- [x] Baseline misurata e salvata in un file (CPU a riposo, RSS, tempo di avvio di Pi con le estensioni), con il comando per ripeterla. — prova: `scripts/perf-baseline.mjs` + `docs/perf.md`: prima 1608 MB, 7,8 s CPU, avvio 942 ms (mediana di 5 con `node scripts/perf-baseline.mjs 20 --json`)
- [x] CPU a riposo di Pi ridotta di almeno il 30% rispetto alla baseline, misurata con lo stesso comando. — prova: CPU totale di Pi nei primi 25 s: 7,8 s → 3,8 s (-51%, mediana di 5, `docs/perf.md`). La CPU a riposo dopo l'avvio era già ~1,6% e resta ~2%: il guadagno sta nel costo di avvio (modello non più caricato a ogni sessione)
- [x] RAM (RSS di Pi più processi figli `claude -p` e `rea mcp`) ridotta di almeno il 30% a parità di scenario, misurata con lo stesso comando. — prova: RAM totale 1608 MB → 1036 MB (-36%); solo Pi 768 → 196 MB (-74%), mediana di 5, `docs/perf.md`
- [x] Tempo di avvio di Pi non peggiorato; ridotto di almeno il 30% se la misura lo permette. — prova: avvio 942 ms prima, 800-1450 ms dopo: rumore, misurato in alternanza old/new (new 1065-1762, old 1045-2005); non peggiorato
- [x] Il timeout di inattività sul pool `claude -p` è attivo e la ripresa dopo la chiusura riparte da sola dal transcript (test verde + prova con `fake-claude`). — prova: `PI_CLAUDE_MCP_TRANSPORT=http … node test/rpc-driver.mjs "ciao" "!procs" "!sleep:4000" "!procs" "e ora?" "!procs"`: processi claude 2 → 0 dopo l'inattività, poi la risposta `ECHO: e ora?` arriva (ripartito dal transcript); `test/idle-reaper.test.ts` verde
- [x] Nessuna regressione: tutti i test dei pacchetti toccati passano e `tsc` non dà errori. — prova: `npm test` pi-claude-code 19/19, pi-memory 142/142 (compresi `embed-process.test.ts` e il nuovo test del caricamento al primo richiamo); `tsc --noEmit -p` pulito nei due pacchetti
- [ ] Modifiche committate con messaggio chiaro, dopo aver controllato che `main` sia allineato con `origin`.

## Utenti e sistemi impattati
Chi usa Pi con pi-claude: `pi-ui` (TUI), `pi-claude-code` (pool di processi), estensioni in `extensions/`, `pi-memory`, `pi-team`.

## Vincoli
- Non riscrivere il contesto già inviato: la cache si rifà e costa di più (+19,6%).
- Il footer di Pi resta semplice, parole chiare, senza simboli o gergo.
- La ripresa di una conversazione dopo un timeout deve restare comoda e veloce.
- Nessuna funzione tolta: si ottimizza, non si spegne.

## Domande aperte
- Quale scenario di misura è rappresentativo (sessione ferma, sessione con agenti attivi)? Decido io: sessione ferma di 60 secondi, più una con pool a 3 sessioni.

## Verifica
```bash
cd /home/fede/documents/projects/pi-claude
npm test --prefix pi-claude-code
npx tsc --noEmit -p pi-claude-code
```
La misura di baseline e finale usa lo script indicato nel primo outcome.
