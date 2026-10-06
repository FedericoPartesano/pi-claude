# pi-claude

Pacchetti:

- [`pi-claude-code`](pi-claude-code/) — provider Pi che usa la CLI ufficiale Claude Code (abbonamento) al posto dell'API Anthropic.
- [`pi-team`](pi-team/) — team di sub-agenti specializzati guidati da un orchestratore.
- [`pi-picker`](pi-picker/) — picker modale globale (file, cartelle, progetti recenti, liste) per Pi e per gli script.

## Installazione

Requisiti: Node ≥ 22.19, git, [Claude Code](https://docs.claude.com/claude-code) loggato con l'abbonamento (`claude` → `/login`).

```bash
git clone git@github.com:FedericoPartesano/pi-claude.git ~/pi-claude
cd ~/pi-claude
git checkout pi-claude-code-v0.1.0   # facoltativo: fissa una release
./install.sh                         # --no-extras: senza pi-full · --no-hooks: senza hook di sicurezza
```

Lo script installa Pi 1.0.4 se manca, il bridge `pi-claude-code`, gli hook `permission-gate` e
`protected-paths`, le estensioni di `pi-full` e il comando `~/.local/bin/pi-full`. Imposta
`claude-code/sonnet` come default solo se non hai già scelto un altro modello. Si può rilanciare:
dopo `git pull` o `git checkout <tag>` basta `./install.sh` di nuovo.

- `pi` — Pi minimale (4 tool base + hook di sicurezza)
- `pi-full` — in più web, todo, domande, subagent e `pi-team`

In `pi-full` i tool extra partono spenti: il modello li accende da solo con `load_tools` quando un compito li richiede
(gruppi `web`, `todo`, `subagent`, `team`), tu con `/tools web team`. Così una richiesta costa ~3,8k token invece di ~11,7k.
`PI_FULL_TOOLS=web,team pi-full` li precarica, `PI_FULL_TOOLS=all pi-full` li tiene tutti accesi.

## Intent

`/intent <idea>` (in `pi` e `pi-full`): il modello ti intervista come un analista (problema, utenti, risultato atteso,
vincoli, fuori scope) e scrive `intents/<data>-<slug>.md` nella root del progetto, con `status: draft`.
`/intent` da solo elenca gli intent con il loro stato. Formato e motivazioni:
[docs/research/2026-10-06-intent-md-best-practices.md](docs/research/2026-10-06-intent-md-best-practices.md).

Uso automatico (zero token: punteggio locale, nessuna chiamata al modello):
- richiesta vaga ("vorrei gli sconti nel carrello", "la paginazione va migliorata") → **chiedi prima**: senza
  dialoghi né file, Pi riceve l'istruzione di fare al massimo 3 domande mirate su ciò che non è specificato prima di
  scrivere codice. Misurato su 6 richieste vaghe: requisiti soddisfatti dal 38% al 75% (`eval/intent-run.mjs`, braccio D);
  richieste piccole, precise o domande passano senza modifiche;
- lavoro grande senza team → "Fissiamo prima l'intent?" (sì = intervista e file, no = Pi procede);
- lavoro grande in `pi-full` → scelta tra intent e poi team, solo team, Pi da solo (sostituisce il dialogo di pi-team);
- all'avvio, se c'è un intent `in-progress`, una notifica lo ricorda; dopo una compaction viene reinserito nel contesto.

`PI_INTENT_ADVISOR=off|ask|auto`: `off` spegne il consigliere; `ask` (default) chiede conferma prima dell'intervista;
`auto` la avvia senza chiedere. Il "chiedi prima" non chiede mai conferma.

## Picker

Un picker modale unico (`pi-picker`), installato sempre, a costo zero finché non lo apri (nessun tool, nessun testo nel
prompt, nessuna scansione all'avvio):
- **Alt+O** (o `/pick`) nel prompt: sfogli il progetto e inserisci uno o più `@file` / `@cartella/`. Ctrl+O è già di Pi.
- **`pi-full --pick`**: prima di avviare Pi scegli il progetto tra i recenti (dalle sessioni di Pi) o navigando dal tuo home.

Tasti: scrivi per filtrare (fuzzy) · ↑↓ PgUp/PgDn · Invio conferma · Spazio segna più voci · Tab/→ entra nella cartella ·
←/Backspace a filtro vuoto sale · Alt+H file nascosti · Esc annulla. Mouse: clic e rotella. Anteprima a destra da 100 colonne.

Per altre estensioni: `pick(ctx, { title, source, multi, preview })` da `pi-picker/src/pick.ts`, con le sorgenti di
`pi-picker/src/sources.ts` (`filesSource`, `dirsSource`, `projectsSource`, `listSource`). L'estensione che la importa va
caricata dal percorso reale (Pi non segue i symlink per gli import relativi).

## Goal

`/goal` (in `pi` e `pi-full`, anche con `-p`) fa lavorare Pi in autonomia finché l'obiettivo non è raggiunto:

```
/goal --check "npm test" sistema i test che falliscono   # chiuso solo quando npm test passa
/goal @intents/2026-10-06-sconti.md                     # obiettivo, vincoli e controlli (sezione Verifica) dall'intent
/goal · /goal stop · /goal resume                        # stato, chiusura, ripresa (anche dell'intent in-progress dopo un riavvio)
```

Se il modello si ferma senza aver chiuso il goal, un promemoria lo fa ripartire (`goal 3/20` nel footer). Lo chiude il tool
`goal_done`, che esegue i controlli: se falliscono, l'output torna al modello e il goal resta aperto. Con un intent lo stato
passa a `in-progress` all'avvio e a `done` a controlli superati; un goal grande o vago scritto a mano genera da sé
l'intent (`intents/<data>-<slug>.md`). Pausa automatica dopo `--max` continuazioni (default 20), due giri di fila senza
tool, Esc, errori, o abbonamento al 90% della finestra di 5 ore / in extra usage. Costo fisso zero: `goal_done` esiste solo
mentre un goal è attivo.

## Loop

`/loop` (in `pi` e `pi-full`, solo TUI) ripete un prompt finché non lo fermi con `/loop stop`:

```
/loop 5m controlla lo stato della CI                 # ogni 5 minuti (s/m/h, minimo 1m), primo giro subito
/loop controlla se la build è finita                 # ritmo deciso dal modello (tool loop_next, 1–60 min)
/loop 10m --when "npm test" controlla i test         # chiama il modello solo se il comando fallisce
```

Con `--when` il giro è un monitoraggio: il modello fa la diagnosi in sola lettura e scrive (o aggiorna) un intent
`intents/…` con `status: draft` e `source: loop`, senza toccare il codice: decidi tu se lanciarlo. Finché il comando
passa non si spende nessun token, e lo stesso errore viene passato al modello una volta sola. Il loop scade dopo 24 h (`--for 8h`) e si ferma se l'abbonamento arriva al 90%
della finestra di 5 ore o passa in extra usage. Se Pi è occupato, il giro aspetta che sia libero. `/loop` mostra lo stato.

## Memoria (`/dream`, `/ricorda`)

Come la memoria umana: le sessioni salvate sono la memoria a breve termine; `/dream` le consolida ("il sonno") in
`.pi/memory.md` (progetto) o, con `--global`, in `~/.pi/agent/memory.md` (preferenze personali). Una sola chiamata a
Haiku propone cosa aggiungere, rinforzare, unire, aggiornare (in caso di contraddizione vince la più recente) o
dimenticare; approvi tu. Le correzioni dell'utente hanno la priorità; i segreti non vengono mai copiati; i ricordi non
riconfermati da 60 giorni sbiadiscono nell'archivio (📌 = mai). La memoria entra nel prompt entro ~1k token; senza
file non costa nulla. `/ricorda <cosa>` cerca nell'archivio (BM25 locale) e, con `--use`, rimette i ricordi nel contesto.
All'avvio una notifica gratuita segnala quando ci sono ≥ 5 sessioni da consolidare.

Variabili: `PI_DREAM_SESSIONS_DIR`, `PI_DREAM_AUTO_APPROVE=1`, `PI_DREAM_MODEL` (default `haiku`),
`PI_MEMORY_GLOBAL_PATH` (vuota = niente memoria globale). Design: `docs/specs/2026-10-06-memory-dream-design.md`.

## Rilasci

Ogni pacchetto ha la sua versione (SemVer) e le sue tag: `pi-claude-code-vX.Y.Z`, `pi-team-vX.Y.Z`, `pi-picker-vX.Y.Z`.
I rilasci sono gestiti da [release-please](https://github.com/googleapis/release-please):
a ogni push su `main` apre (o aggiorna) una PR di rilascio per ogni pacchetto modificato;
il merge della PR crea tag, GitHub Release e voce nel `CHANGELOG.md` del pacchetto.

I commit seguono [Conventional Commits](https://www.conventionalcommits.org/), con il pacchetto come scope:

```
fix(pi-claude-code): corregge il parsing dei tool JSON
feat(pi-team): aggiunge il ruolo documenter
feat(pi-team)!: cambia lo schema del piano      # breaking
```

Finché la versione è `0.x`: `feat` e breaking alzano il minor, `fix` il patch.
