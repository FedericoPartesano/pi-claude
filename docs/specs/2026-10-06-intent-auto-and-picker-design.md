# Uso automatico degli intent + picker modale globale — design

Data: 2026-10-06 · Stato: approvato in chat dall'utente · Base: `/intent` già implementato (`extensions/intent.ts`).

## A. Uso automatico degli intent

Principio: intent solo quando serve (richieste ambigue/grandi, lavori su più sessioni); mai burocrazia sui compiti
piccoli. Zero token fissi: niente tool né testo permanente nel system prompt; decisioni con euristica locale.

### Livello 1 — automatismi senza decisioni
- **Avvio sessione**: se `intents/` ha intent `in-progress` → notifica "Lavoro in corso: <titolo> → /goal resume"
  (finché /goal non esiste: "→ /intent").
- **Compaction**: l'intent attivo (il più recente `in-progress`) viene reinserito nel riassunto (titolo, outcome,
  vincoli, domande aperte), così i vincoli sopravvivono.
- **Stati**: `setStatus` usato da /goal (sotto-progetto successivo). Rinviati a /goal anche "intent automatico per goal grandi".

### Livello 2 — consigliere unico a tre esiti
Unifica il consigliere di pi-team (`pi-team/src/advisor.ts`, punteggio locale) con quello degli intent:

| Richiesta | Esito |
|---|---|
| piccola e precisa | Pi diretto (nessuna interruzione) |
| ambigua / feature | "Fissiamo prima l'intent?" → intervista /intent, poi lavoro |
| grande, più parti | intent + team (solo se il tool `team` è registrato, cioè pi-full) |

- Segnali: lunghezza, verbi d'intenzione ("voglio", "dovrebbe", "aggiungere una funzionalità", "implementare"),
  più risultati richiesti, assenza di file/simboli precisi, aree toccate (già nel consigliere team).
- Un solo dialogo per richiesta: il consigliere team di pi-team non deve chiedere a sua volta.
- Se esiste già un intent `in-progress` pertinente o la richiesta cita `intents/…` → non proporre un nuovo intent.
- `PI_INTENT_ADVISOR=off|ask|auto` (default `ask`; `auto` avvia l'intervista senza chiedere).
- Con tool-groups (pi-full) il gruppo `team` va acceso quando l'esito è team, senza passare per `load_tools`.
- Test con frasi reali (come `pi-team/test/advisor.test.ts`): piccole → diretto, feature vaghe → intent, multi-parte → team.

### Implementazione (scelte prese)
- Logica pura in `extensions/work-advisor.ts` (`adviseWork`), che riusa `adviseTeam`/`countParts` di pi-team per
  l'esito team; UI nell'handler `input` di `extensions/intent.ts`. Lavoro grande senza team disponibile → intent.
  Le richieste "già precise" (≥ 2 tra file, identificatori, backtick, errori) restano dirette: lo sono i 6 casi
  compositi della valutazione.
- Esito team: un `select` a tre voci ("Intent e poi team" / "Solo team" / "Pi da solo") invece di un confirm.
  L'accensione del gruppo passa per `pi.events.emit("tool-groups:load", ["team"])`, ascoltato da tool-groups.
- pi-team tace se è impostato `globalThis[Symbol.for("pi-claude.work-advisor")]` (lo imposta intent.ts, salvo
  `PI_INTENT_ADVISOR=off`): senza intent.ts pi-team si comporta come prima.
- Compaction: a `session_compact` un `sendMessage` (`customType: intent-reminder`, `deliverAs: nextTurn`) con
  `renderIntentReminder`; il riassunto di Pi resta intatto.
- **Import e symlink**: verificato che Pi NON risolve i symlink per gli import relativi (`Cannot find module
  '../pi-team/src/advisor.ts'` da un'estensione collegata). `install.sh` quindi registra il percorso reale di
  `intent.ts` in `settings.json → extensions` (idempotente, rimuove un vecchio symlink). Vale anche per `pi-picker`.

## B. Picker modale globale

Un componente (`pi-tui`), due host: overlay dentro Pi (`ctx.ui.custom(..., { overlay: true })`) e programma
standalone (per scegliere il progetto prima di avviare Pi: `newSession` non accetta una cwd).

- API: `pick(ctx, { title, source, multi?, preview? }): Promise<string[] | undefined>`; senza TUI completa →
  `ctx.ui.select`; in `-p` → `undefined`.
- Sorgenti: `files` (`git ls-files` se repo, altrimenti walk senza `node_modules`/`.git`, con limite), `dirs`,
  `recentProjects` (primo record `{"type":"session","cwd",...}` dei file in `~/.pi/agent/sessions/*/`, ordinati per
  uso, solo cartelle esistenti), `intents` (titolo, stato; anteprima = outcome), `list` (fornita dal chiamante).
- Tasti: digitare = filtro fuzzy · ↑↓ PgUp/PgDn · Invio conferma · Spazio multi-selezione · →/Tab entra in cartella ·
  ←/Backspace a filtro vuoto sale · Alt+H nascosti (Ctrl+H = Backspace in molti terminali) · Esc annulla. Mouse: click/scroll. Anteprima a destra se ≥ 100 colonne.
- Usi: **Alt+O** nel prompt (Ctrl+O è già di Pi) → inserisce `@percorso` (anche multipli, `pasteToEditor`); **`pi-full --pick`** → scegli
  progetto (recenti o navigazione) e Pi parte lì; poi `/intent` e `/goal` senza argomenti usano il picker.
- Codice: pacchetto locale `pi-picker/` (libreria + estensione Ctrl+O), installato con `pi install` come
  `pi-claude-code`. Da verificare: import della libreria da estensioni collegate via symlink.
- Test: funzioni pure (filtro, navigazione ad albero, recenti, elenco file), rendering a larghezza fissa, prova tmux.

## C. `/goal` (approvato in chat)

- Comandi: `/goal [--check "cmd"] [--max N] <obiettivo>` · `/goal @intents/<file>.md` · `/goal` (stato) ·
  `/goal stop` · `/goal resume` (riprende un goal in pausa, o l'intent `in-progress` dopo un riavvio).
- Avvio: accende il tool `goal_done(summary, blocked?)` (spento altrimenti, aggiunto ai tool attivi correnti),
  manda un messaggio utente con obiettivo e regola "quando hai finito chiama goal_done".
- Con intent: `Verifica` → check (salvo `--check`), outcome e vincoli nei promemoria, `setStatus(in-progress)` all'avvio
  e `done` a verifica passata. Domande aperte non vuote → il primo messaggio chiede di chiuderle con l'utente e
  aggiornare l'intent prima di lavorare.
- Goal da testo "grande" (funzione pura `shouldCreateIntent`, da allineare poi al consigliere unico) → il primo messaggio
  chiede di sintetizzare `intents/<data>-<slug>.md` (status in-progress, senza intervista) e il goal si lega a quel file.
- `agent_before_settle` senza goal_done → entry promemoria + `continue: true`; footer `goal 3/20`.
- goal_done: con check → esegue (bash, timeout); fallisce → coda output al modello, goal continua; passa / nessun
  check → chiuso, tool spento, notifica. `blocked: true` → pausa e domanda all'utente.
- Pausa automatica (con notifica): `--max` (default 20) continuazioni; 2 continuazioni consecutive senza tool call;
  interruzione (Esc); abbonamento 5h ≥ 90% o overage (`readUsage`/`decideBudget` di pi-team).

## D. `/loop` (approvato in chat)

- `/loop [intervallo] [--when "cmd"] [--for 24h] <prompt>` · `/loop` (stato) · `/loop stop`. Un loop alla volta.
- Intervallo `s/m/h`, minimo 1m, primo giro subito. Senza intervallo: ritmo deciso dal modello col tool
  `loop_next(delaySeconds, reason)` (acceso solo durante il loop, 60–3600 s); se non lo chiama, il loop finisce.
- `--when "cmd"`: a ogni giro il codice esegue il comando; exit 0 → nessuna chiamata al modello (footer "ok hh:mm");
  exit ≠ 0 → manda il prompt con la coda dell'output. Con `--when` il comportamento predefinito è da stage 6:
  diagnosi in sola lettura e scrittura/aggiornamento di `intents/<data>-<slug>.md` (`status: draft`, `source: loop`),
  senza correggere; se esiste già un intent draft del loop sullo stesso problema, lo aggiorna.
- Giro mentre Pi è occupato → attende `agent_settled`, max un giro in attesa. Solo modalità interattiva.
  Esc ferma solo il giro corrente. Scadenza 24 h (`--for`). Stop su abbonamento 5h ≥ 90% o overage.
- Footer `loop 5m · giro 3 · prossimo 14:05`.
