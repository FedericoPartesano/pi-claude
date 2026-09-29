# Team orchestrator per Pi — design (sotto-progetto 1)

Data: 2026-09-24 · Stato: approvato per delega ("procedi come meglio credi")

## Obiettivo
Un "team" di sub-agenti specializzati guidato da un manager, dentro Pi (bridge claude-code, abbonamento).
Il **modello decide** (scomposizione, ruoli, istruzioni); il **codice garantisce**: checkpoint sul piano,
verifica empirica, tentativi, budget.

Scelte dell'utente: checkpoint sul piano · verifica = prove empiriche (giudice) + revisore · budget adattivo.
Fuori scope (sotto-progetti successivi): memoria/apprendimento, team di ricerca, flusso TaskSphere.

## Componenti (pacchetto `pi-team/`)
| Unità | Responsabilità |
|---|---|
| `roles.ts` | carica i ruoli: `roles/*.md` del pacchetto + override in `~/.pi/agent/team/roles/*.md` (frontmatter: name, description, model, thinking, tools; corpo = istruzioni) |
| `plan.ts` | schema e validazione del piano (id unici, ruoli esistenti, dipendenze esistenti e acicliche, `verify` obbligatorio per chi scrive codice) + rendering testuale |
| `budget.ts` | politica di parallelismo dalla finestra 5h dell'abbonamento (file scritto da pi-claude-code) |
| `runner.ts` | esegue un agente: `pi --mode json -p --no-session --provider claude-code --model <m> --thinking <t> --tools <lista> --append-system-prompt <ruolo>`; raccoglie testo finale, token, errori |
| `verify.ts` | esegue comandi di verifica (bash, timeout) e restituisce esito + coda dell'output |
| `orchestrator.ts` | ciclo: scheduler DAG → verifica per compito → tentativi con feedback → verifica finale → revisore → correzione → report |
| `index.ts` | registra il tool `team` in Pi (checkpoint via `ctx.ui.select`, avanzamento via `onUpdate`) |

## Ruoli di base
- **scout** (haiku, read+bash, sola lettura di fatto): esplora e riporta fatti con file:riga.
- **implementer** (sonnet, tutti i tool): implementa un compito circoscritto.
- **tester** (sonnet, tutti i tool): scrive/aggiorna test per un comportamento.
- **reviewer** (sonnet, read+bash): rilegge il diff rispetto all'obiettivo; risponde `VERDETTO: APPROVATO` oppure `VERDETTO: MODIFICHE` + elenco.

## Piano (argomento del tool `team`)
```json
{ "goal": "...", "tasks": [ { "id": "t1", "role": "scout", "title": "...", "instructions": "...",
  "dependsOn": [], "verify": ["npm test"] } ], "finalVerify": ["npm test"], "review": true }
```

## Ciclo di esecuzione
1. Validazione piano (errori → restituiti al manager per correggerlo).
2. **Checkpoint**: con UI → select Approva/Rifiuta sul piano renderizzato; senza UI → rifiuto, salvo `PI_TEAM_AUTO_APPROVE=1`.
3. Scheduler: compiti pronti (dipendenze completate) eseguiti con parallelismo = budget; **chi scrive
   (implementer/tester) mai in parallelo** (evita conflitti sui file); scout/reviewer in parallelo.
4. Ogni compito riceve: istruzioni + obiettivo + output (riassunto) delle dipendenze.
5. Dopo ogni compito con `verify`: comandi eseguiti dal codice. Fallimento → nuovo tentativo dello stesso
   ruolo con l'output dell'errore (max 3 tentativi). Dipendenti di un compito fallito → saltati.
6. `finalVerify` sul risultato complessivo; se fallisce → compito correttivo implementer (max 2 giri).
7. Revisore (se `review`): se chiede modifiche → compito correttivo + ri-verifica finale (1 giro).
   **I test decidono**: con test verdi e revisore insoddisfatto a fine giri, esito "verificato, note del revisore aperte".
8. Report al manager: stato per compito, tentativi, esiti verifica, verdetto revisore, token/tempo per agente.

## Budget
`pi-claude-code` scrive `~/.pi/agent/claude-code-usage.json` (finestre 5h/7g, overage) a ogni `rate_limit_event`.
Parallelismo: 5h <50% → 3 · <70% → 2 · <90% → 1 · ≥90% o overage → il tool si ferma prima di iniziare e lo dice.

## Errori
Processo agente fallito/timeout (20 min default) → tentativo come verifica fallita. Abort dell'utente → kill dei figli.
Nessun agente può avviare il team (i figli non caricano l'estensione).

## Test
- Unitari (node:test): validazione piano, scheduler con runner finto, ciclo tentativi/verifica, budget.
- Empirici: casi compositi sulla fixture `eval/` confrontando `pi-full` vs `pi-full + team` (esito, token, tempo).
