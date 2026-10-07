# HANDOFF — pi-claude (ripresa lavori)

Ultimo aggiornamento: 2026-09-24 (sessione interrotta per spegnimento PC).
Per riprendere: apri Claude Code **in `~/documents/projects/pi-claude`** (non in smartlookup-mono) e fagli leggere questo file.

## Cosa esiste ed è FUNZIONANTE
- **Bridge `pi-claude-code/`**: Pi usa i modelli Claude tramite il binario `claude` (abbonamento, niente extra usage).
  - Installato in Pi (`pi install ~/documents/projects/pi-claude/pi-claude-code`); default Pi = `claude-code/sonnet`.
  - Trasporto MCP `sdk` (default): tool con nomi esatti `read/edit/bash/write`; HTTP con `PI_CLAUDE_MCP_TRANSPORT=http`.
  - Resume nativo (fork/tree/compaction), thinking → `--effort`, pre-avvio in TUI, footer `abbonamento 5h X% · 7g Y%`.
  - BUG-1 (JSON tool non valido) corretto. Typecheck: `cd pi-claude-code && npx tsc -p .`
- **Pi globale 1.0.4** (aggiornato da 0.87.1 il 2026-10-06, branch `chore/pi-1.0.4`). Comandi: `pi` (minimale, ~3,6k token/richiesta) e `pi-full` (`~/.local/bin/pi-full`: + web, todo, domande, subagent, team; tool su richiesta, ~3,8k).
- **Hook di sicurezza** in `~/.pi/agent/extensions/`: `permission-gate` (esempio ufficiale) e `protected-paths` → symlink a `extensions/protected-paths.ts` (bash-aware, test: `node --test extensions/protected-paths.test.ts`).
- **Skill in Pi**: solo tdd, diagnosing-bugs, code-review, resolving-merge-conflicts (altre 12 escluse in `~/.pi/agent/settings.json`).
- **Valutazione `eval/`**: 50 casi, report `eval/REPORT.md` (Pi 50/50 dopo fix, −90% token input, −30/35% tempo vs Claude Code). Rilancio: `cd eval && node run.mjs --run <nome>`; analisi `node analyze.mjs <nome>`.
- Note complete della storia: `NOTES.md`, risultati bench: `bench/RESULTS.md`.

- **Tool su richiesta in pi-full** (2026-10-06): `extensions/tool-groups.ts` spegne web/todo/subagent/team e registra
  `load_tools` + `/tools`. Prima richiesta 11,7k → 3,8k token (pi base 3,6k). Il modello carica il gruppo e lo usa nello
  stesso turno (il bridge riparte dal transcript con i tool nuovi). Prewarm del bridge rimandato con `setTimeout(0)` per
  vedere i tool già filtrati: `reuse=yes` verificato in TUI.

- **2026-10-06 — intent, goal, loop, picker** (branch `feat/intent-goal-loop-picker`, spec
  `docs/specs/2026-10-06-intent-auto-and-picker-design.md`): `/intent` (intervista a domande concrete, ≤3 per messaggio),
  consigliere locale con "chiedi prima" sulle richieste vaghe, `/goal` (check decide la fine), `/loop` (`--when` a costo zero),
  `pi-picker` (Alt+O, `pi-full --pick`, intent). Tutto a costo fisso zero (pi 3,57k token, pi-full 3,80k).
  Valutazione con/senza intent in `eval/REPORT.md`: diretto 28-38%, "chiedi prima" 75%, intent nuova intervista 83%.
  Installazione: `install.sh` registra intent/goal/loop in settings.json con percorso reale (Pi non segue i symlink
  negli import relativi).

- **2026-10-06 — memoria (`/dream`, `/ricorda`)**, branch `feat/memory-dream` (sopra `chore/pi-1.0.4`): spec
  `docs/specs/2026-10-06-memory-dream-design.md` (con tetto) e `docs/specs/2026-10-06-deep-memory-design.md` (profonda a
  richiamo, default; `PI_MEMORY_MODE=capped` per la vecchia). Risultati in `eval/MEMORY-REPORT.md`: regole rispettate
  none 67% · capped 88% · deep 83% con 44–100 token iniettati per richiesta (capped 271–910). Pacchetto `pi-memory/`
  (embedding locale, 888 MB di node_modules). Prossimi passi: soglia un po' più alta (domanda estranea: 1 ricordo
  iniettato), regole di stile trasversali sempre richiamate nei compiti che scrivono codice, poi **TUI per vedere e
  gestire la memoria** (`/memoria`: elenco con filtri, anteprima con entità e origine, azioni 📌/modifica/unisci/
  superato/archivia/elimina, "perché è stato richiamato" dal recall-log), costruita sul picker, costo zero.

## Problemi aperti noti
- BUG-2: via bridge il modello preferisce bash a read/edit (158 vs 10). NON dipende dal prefisso nomi (verificato). Comportamento del modello.
- Ricerca web di pi-web-access (Exa senza chiave) può dare dati vecchi (es. versione npm sbagliata).

## LAVORO IN CORSO: team di sub-agenti con orchestratore (`pi-team/`)
Spec: `docs/specs/2026-09-24-team-orchestrator-design.md` (approccio A: il modello pianifica, il codice garantisce
checkpoint sul piano, verifica empirica con test, tentativi, budget adattivo). Scelte utente: checkpoint sul piano,
test empirici come giudice + revisore, budget adattivo, sotto-progetto 1 = orchestratore + team base (sviluppo).

### Fatto
- `pi-team/package.json`, `tsconfig.json`, `npm install` fatto.
- `src/plan.ts` (schema TeamPlan/TeamTask, `validatePlan` con cicli/dipendenze/ruoli/verify obbligatorio per chi scrive, `renderPlan`)
- `src/roles.ts` (`parseRole`, `loadRoles` da `roles/` + override `~/.pi/agent/team/roles/`)
- `src/budget.ts` (`decideBudget`: 5h <50%→3, <70%→2, <90%→1, ≥90% o overage→0; `readUsage` da `~/.pi/agent/claude-code-usage.json`)
- `src/verify.ts` (`runVerifyCommand(s)`: bash, timeout, coda output)
- `src/runner.ts` (`runAgent`: `pi --mode json -p --no-session --provider claude-code --model --thinking --tools --append-system-prompt <ruolo> <prompt>`, env `PI_TEAM_CHILD=1`)
- `roles/`: scout (haiku, read+bash), implementer (sonnet, writes), tester (sonnet, writes), reviewer (sonnet, verdetto `VERDETTO: APPROVATO|MODIFICHE`)

### Fatto dopo il riavvio (2026-09-25)
1. ✅ pi-claude-code scrive `~/.pi/agent/claude-code-usage.json` a ogni rate_limit_event (verificato in RPC).
2. ✅ `src/orchestrator.ts` (scheduler DAG, writer uno alla volta, verify+3 tentativi, finalVerify+giri correttivi, revisore, report).
3. ✅ `index.ts`: tool `team` (validazione, budget, checkpoint `ctx.ui.confirm`, `PI_TEAM_AUTO_APPROVE=1`, avanzamento, report).
4. ✅ Test unitari: `cd pi-team && npm test` → 14/14.
5. ✅ `pi-full` carica pi-team.
6. ⏳ Valutazione empirica in corso: `eval/team-cases.mjs` (6 casi compositi), harness `pi` vs `pi-team`,
   2 giri → `eval/results/team-r1.jsonl`, `team-r2.jsonl`, log `~/.cache/pi-eval/team.out`.
   Rilancio: `cd eval && EVAL_TURN_TIMEOUT_MS=2400000 node run.mjs --cases ./team-cases.mjs --harness pi,pi-team --run team-rN --concurrency 2`
   Primo smoke test reale: team usato, report VERIFICATO, 11/11 test — ma il manager ha messo tutto in 1 compito.

7. ✅ Valutazione team completata e registrata in `eval/REPORT.md` (sezione "Team di sub-agenti"):
   stessa qualità di Pi da solo (12/12), ma 2,8× tempo e 3,4× token → team opzionale per lavori grandi.
8. ✅ Baseline dei controlli preesistenti nell'orchestratore (esito `verified_with_preexisting_failures`), 16/16 test.

9. ✅ Consigliere Pi vs team (`pi-team/src/advisor.ts`): dialogo in pi-full solo per lavori grandi, `/consiglia`; 22/22 test; provato in TUI.

### Possibili sviluppi (non iniziati)
- Valutare il team su lavori grandi (ore di lavoro, più moduli) dove un solo contesto non basta.
- Sotto-progetti: memoria/lezioni apprese, team di ricerca, flusso TaskSphere.

## Regole di lavoro emerse
- Progetto NON legato a smartlookup-mono: niente vault/log/memoria di quel repo.
- Niente commit senza richiesta. Niente `--dangerously-skip-permissions` lanciato da Claude (bloccato dal classificatore).
- Mai `--bare` (forza API key = extra usage). Verificare sempre `isUsingOverage:false` dopo cambi al bridge.
