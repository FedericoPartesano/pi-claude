# Lean tools: meno token per cercare e leggere, stessa qualità

Data: 2026-10-08 · Stato: implementata e misurata (`eval/LEAN-REPORT.md`): accesi di default solo i pezzi a costo fisso zero (riletture, bash, raggruppamento di grep); `search` e `outline` opzionali

## Perché

Nel primo giro di valutazione Pi ha usato quasi solo `bash` (`grep -rn`, `find`, `cat`, `sed`). Il suo output spreca
token: il percorso ripetuto su ogni riga, righe minificate lunghissime, `node_modules`, file letti per intero, suite di
test stampate tutte anche quando serve solo sapere cosa fallisce. Obiettivo: ridurre i token in input **senza perdere
correttezza**, e dimostrarlo con misure.

## Cosa si costruisce

Un'estensione `extensions/lean-tools.ts` (logica pura in `extensions/lean/*.ts`, testata), caricata da `pi` come le
altre estensioni del repo. Spenta con `PI_LEAN=0`; i singoli pezzi con `PI_LEAN_SEARCH=0`, `PI_LEAN_OUTLINE=0`,
`PI_LEAN_REREAD=0`, `PI_LEAN_BASH=0`.

1. **`search`** (tool nuovo, ripgrep):
   - contenuto: risultati raggruppati per file (percorso una volta), `riga: testo`, righe tagliate a 160 caratteri,
     al massimo 5 risultati per file e 60 in tutto, poi i conteggi ("e altri 37 in 12 file"); rispetta `.gitignore`;
     opzioni `glob`, `ignoreCase`, `literal`, `context` (righe attorno, default 0), `limit`;
   - `files: true`: nomi di file che corrispondono (rg `--files` + filtro), ordinati per pertinenza (nome esatto,
     poi prefisso, poi sottostringa; percorsi più corti prima), al massimo 50;
   - `semantic: true`: ricerca per significato nel codice (vedi 5).
2. **`outline`** (tool nuovo): senza `symbol`, lo scheletro di un file (funzioni, classi, metodi, export, con la
   riga); con `symbol`, solo il corpo di quel simbolo (con i numeri di riga), per JS/TS, Python e un ripiego generico
   a parentesi/indentazione. Niente dipendenze native (espressioni regolari e conteggio di parentesi).
3. **Riletture** (nessun tool nuovo, evento `tool_result` di `read`): se il modello rilegge lo stesso intervallo di un
   file **non cambiato** (stesso hash) già letto in questa sessione e dopo l'ultima compattazione, il contenuto è
   sostituito da `[invariato dalla lettura del passo N: stesso contenuto già nel contesto]`. Dopo una compattazione la
   memoria delle letture si azzera.
4. **Output di bash più asciutto** (evento `tool_result` di `bash`), solo sopra 120 righe:
   - output di test riconosciuto (node:test spec/TAP, vitest, jest, pytest): restano i fallimenti con il loro
     dettaglio e il riepilogo; i test passati diventano un conteggio;
   - altro output: prime 40 e ultime 60 righe, con `[… N righe omesse: output completo in <file>]` (il file è quello che
     Pi salva già quando tronca, o uno nuovo in `$TMPDIR`);
   - sempre: via le sequenze ANSI, righe identiche consecutive collassate (`… ×N`), righe oltre 400 caratteri tagliate.
   - mai compattato: comando che fallisce con meno di 300 righe, output già piccolo, o comando che contiene
     `PI_LEAN_FULL=1`.
5. **Ricerca semantica** (`search` con `semantic: true`): indice dei simboli del progetto (da `outline`) con gli
   embedding locali di `pi-memory/src/embed.ts` (e5-small), salvato in `.pi/code-index.json` e aggiornato per i file
   cambiati (mtime). Restituisce i 8 simboli più vicini con file:riga e prima riga. Se gli embedding non sono pronti,
   ripiega sulla ricerca testuale e lo dice.

## Vincoli

- Costo fisso: le descrizioni di `search` e `outline` insieme ≤ 250 token (misurati con il prompt di sistema). Misurato: +368 (search +228, outline +140) → spenti di default.
- Nessuna dipendenza nativa; `rg` richiesto (c'è; se manca, `search` lo dice e il modello usa bash).
- Qualità: nessuna informazione persa senza un modo di recuperarla (file completo, intervallo di righe, opzioni).

## Esperimenti (risultati in `eval/LEAN-REPORT.md`)

- **E1 offline, ricerca**: 20 ricerche reali su `yaml`, `marked` e questo repo; caratteri e token stimati di
  `grep -rn`, del `grep` di Pi e di `search`, e se il risultato atteso (file:riga) è presente in tutti.
- **E2 offline, bash**: output reali (suite di test di `yaml`/`marked` con fallimenti indotti, `git log`, `find`, log
  grandi della fixture): dimensione prima/dopo e presenza dei nomi dei test falliti e delle righe d'errore.
- **E3 online, primo giro**: i 50 casi di `eval/cases.mjs`, Sonnet, `pi` contro `pi` + lean-tools, 1 ripetizione
  (2 per i casi che cambiano esito): casi passati, token in input, tempo.
- **E4 online, repo grande**: 10 domande di navigazione del codice su `marked` (risposte verificabili), Sonnet, stessi
  due bracci.
- **Criterio di successo**: token in input −15% o meglio su E3+E4 con al massimo 1 caso passato in meno (rumore);
  altrimenti si spengono i pezzi che non rendono.
