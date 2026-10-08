# Eval 2: Pi vs Claude Code su compiti difficili, con Opus e memoria

Data: 2026-10-08 · Stato: bozza da rivedere

## Perché

Il primo giro (`eval/REPORT.md`, 50 casi su una fixture piccola, Sonnet) ha mostrato correttezza alla pari, Pi −90%
token in input e −35% tempo. Non dice se Pi è **più bravo**: i compiti erano facili, il modello non era quello che usi e
la memoria di Pi non è mai stata messa contro quella di Claude Code. Questo giro serve a decidere quale strumento usare
ogni giorno, con una risposta per tre domande:

1. **Compiti difficili**: su bug reali di un progetto open source, chi ne risolve di più?
2. **Memoria**: regole insegnate in sessioni passate, chi le rispetta di più in sessioni nuove (auto-memory di Claude
   Code contro `/dream` di Pi)?
3. **Costo**: token, tempo e richieste per arrivarci.

## Decisioni prese (con l'utente)

- Codice: **bug storici di repo open source** (stile SWE-bench), non fixture inventate né repo di lavoro.
- Dimensione: **20 compiti × 2 ripetizioni** per harness (80 esecuzioni) più il braccio memoria.
- Memoria: **sessioni vere di insegnamento** giocate in entrambi; ognuno salva con il suo meccanismo.
- Configurazione: **come li usi tu**: Claude Code con la config reale (hook, plugin, skill, CLAUDE.md globale), Pi come
  `pi-full` (tutte le estensioni di `bin/pi-full`).
- Modello: **Opus**, effort `high` per entrambi (Pi `--thinking high` → bridge `--effort high`; Claude Code `--effort high`).

## Vincoli

- Solo abbonamento Claude: mai `--bare`, mai API key. Prima e dopo ogni esecuzione si legge
  `~/.pi/agent/claude-code-usage.json`: se `isUsingOverage` è `true` il run si ferma (nessun job nuovo parte).
- Controlli automatici (test eseguiti), nessun giudizio a occhio. Il giudizio umano serve solo per l'analisi caso per caso.
- Ripresa: stesso `--run` riparte dai job mancanti (come `eval/run.mjs`).
- Isolamento: ogni esecuzione su una copia pulita del repo al commit del compito, sotto `~/.cache/pi-eval/work2/`.
- Niente rete verso GitHub durante l'esecuzione degli agenti: l'issue è nel prompt, il repo è locale (l'agente non deve
  poter scaricare la correzione). La rete serve solo nella fase di preparazione.

## Parte 1: compiti difficili

### Repo

Due repo JS/TS con test veloci (suite completa < 60 s) e molte correzioni accompagnate da test:

- `eemeli/yaml` (parser/stringify YAML, TS),
- `markedjs/marked` (parser Markdown, JS/TS).

Se uno dei due non dà 10 compiti validi (vedi sotto), si sostituisce con `colinhacks/zod`. La scelta finale e i commit
sono scritti in `eval/round2/tasks.json` e versionati.

### Estrazione dei compiti (`eval/round2/mine.mjs`)

Per ogni commit di correzione candidato (messaggio con `fix`, oppure PR che chiude un'issue etichettata bug):

1. Separa i file toccati in **sorgente** e **test**.
2. Il compito è valido se:
   - la correzione tocca **≥ 2 file sorgente oppure > 20 righe** di sorgente (compiti difficili, non one-liner);
   - i test della correzione, applicati al commit **precedente**, **falliscono** (almeno un test);
   - gli stessi test **passano** con la correzione applicata;
   - la suite completa al commit precedente, senza i test nuovi, ha un elenco stabile di test che passano (baseline,
     eseguita 2 volte: i test instabili sono esclusi dal controllo);
   - esiste un testo di issue (titolo + corpo) che descrive il problema **senza** contenere il diff della soluzione.
     Se il commit non ha issue collegata, il compito si scarta (niente prompt scritti a mano).
3. Salva per ogni compito: repo, commit base, testo dell'issue, file di test nascosti, elenco dei test della baseline,
   righe e file della correzione di riferimento.

Si prendono i 10 compiti più recenti validi per repo (più recenti = meno probabile che il modello li abbia visti), con
almeno 3 compiti che toccano ≥ 3 file.

### Prompt

Uguale per entrambi gli harness, un solo turno:

> Nel repository corrente c'è questo problema segnalato da un utente:
> <titolo e corpo dell'issue>
> Correggilo. Puoi lanciare i test del progetto. Non serve fare commit.

### Controllo

Dopo l'esecuzione dell'agente:

1. Si copiano i file di test nascosti (sovrascrivendo eventuali modifiche dell'agente a quegli stessi file).
2. Si lanciano i test nascosti a parte, poi la suite completa.
3. **Pass** se: tutti i test nascosti passano **e** nessun test della baseline smette di passare.
4. Si registrano anche: file toccati e tool usati (se ha lanciato i test si legge nei log).

### Metriche per esecuzione

Riutilizzate da `eval/harness.mjs`: secondi, richieste, token in/out, tool usati, errori, timeout. In più: esito del
controllo e motivo (test nascosti falliti, regressioni, timeout, errore dell'harness).

## Parte 2: memoria

Stesso schema di `eval/memory-cases.mjs`, ma su uno dei due repo reali e contro Claude Code.

- **6 regole** di progetto che il codice non permette di dedurre (es. nomi dei test, lingua dei messaggi di errore,
  JSDoc obbligatorio sulle funzioni esportate, niente dipendenze nuove, formato del changelog, file di test separati
  per funzione nuova). Ogni regola ha un controllo automatico.
- **5-6 sessioni di insegnamento**: compiti piccoli in cui l'utente simulato (`eval/sim-user.mjs`, Claude Code
  headless senza config utente) corregge l'agente quando viola una regola. Giocate davvero in entrambi gli harness,
  nella **stessa directory** per tutto il braccio (la memoria di Claude Code è legata al percorso del progetto):
  - Claude Code: con la sua auto-memory, nessun aiuto esterno;
  - Pi: con `extensions/memory.ts`, `/dream` lanciato alla fine delle sessioni, come farebbe l'utente.
- **5 compiti nuovi** in sessione pulita, che invitano a violare le regole senza nominarle. Misura: regole rispettate
  sulle applicabili, come in `eval/MEMORY-REPORT.md`.
- **Controllo di partenza**: un braccio "senza memoria" per entrambi (stessi compiti, nessuna sessione prima), per
  sapere quanto ognuno indovina da solo.
- Ripetizioni: 2 per harness.

## Report (`eval/REPORT-2.md`)

- Tabella riassuntiva: compiti risolti (su 40 esecuzioni per harness, e per compito "risolto almeno 1 volta su 2"),
  token in/out, tempo, richieste.
- Memoria: regole rispettate con e senza memoria, per harness.
- Caso per caso: esito, motivo dei fallimenti, cosa ha fatto di diverso l'altro harness.
- Conclusione esplicita: "Pi è più bravo / alla pari / meno bravo, e dove", con l'incertezza (con 20 compiti × 2 una
  differenza di 1-2 compiti è rumore; si dice quando lo è).

## Rischi e verifiche preliminari

- **Auto-memory di Claude Code in `-p`**: va verificato che in modalità headless scriva davvero memoria (probe prima di
  costruire il braccio). Se non la scrive, il braccio memoria di Claude Code si fa in sessioni interattive pilotate in
  tmux, oppure si dichiara il limite nel report.
- Esito sonda (2026-10-08): **cc-memory: headless**. In `-p` Claude Code ha scritto `MEMORY.md` e `messaggi-errore-in-italiano.md` sotto `~/.claude/projects/<percorso>/memory/` e nella sessione nuova ha risposto "Italiano". Il braccio memoria usa l'harness headless, niente tmux.
- **`pi-full` in RPC**: `eval/harness.mjs` lancia `pi`; va aggiunta l'opzione per lanciare le stesse estensioni di
  `bin/pi-full`.
- **Quota**: stima ~1,5-3M token in input su 80 esecuzioni Opus più la memoria; si lancia di notte, a blocchi, con stop
  automatico sull'extra usage.
- **Contaminazione**: lo stesso modello può aver visto le correzioni; vale per entrambi, quindi il confronto resta
  equo. Si preferiscono commit recenti.
- **Dialoghi di conferma**: in Pi rispondono "annulla" come nel primo giro; in Claude Code `acceptEdits` più
  allowlist. Si registra quante volte un agente è stato bloccato.

## Fuori scope

pi-team (già misurato: non batte Pi da solo), Sonnet, configurazioni "pulite", compiti non verificabili con test.
