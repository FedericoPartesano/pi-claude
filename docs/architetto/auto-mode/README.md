# Auto mode: Pi che porta a termine un goal in autonomia
Aggiornato: 2026-11-09 · chiuso il 2026-11-09

## In dieci righe
- `/auto <goal>` lavora su un branch `auto/<slug>` in un git worktree. Il ciclo è define → plan → build → verify → review → ship, con le skill prese da `skills/phases.json`.
- Ogni passo è un processo figlio `pi -p --no-extensions` con cwd nel worktree. Nel Pi dell'utente resta solo un supervisore fatto di codice, che costa 0 token a riposo.
- Lo stato sta in `auto/` (stato, requisiti con `passes`, decisioni, azioni da approvare) e in git. `/auto resume` riparte dall'ultimo commit.
- Il lavoro è finito solo quando lo dice il supervisore: rilancia i check congelati con hash a fine plan e calcola lui `passes`. Nessuno dei 4 repo studiati lo fa.
- Permessi:
  - lista nera nel codice (`tool_call`), ricavata dalle regole di Claude Code auto mode;
  - comandi bash dentro `bwrap` dove c'è: filesystem in sola lettura fuori dal worktree, rete spenta da build in poi;
  - dove `bwrap` manca, `unshare -rn`.
- Arresto con motivi tipizzati: soglie di stallo, timeout per passo, tetto del 50% della finestra 5h e di 3 h.
- Misure: prefisso di 4 554 token per turno nel figlio contro 23 906 nella sessione completa; avvio 4,4–6,6 s; `bwrap` 0,04 s.
- Esclusa l'orchestrazione con `newSession` nella sessione dell'utente: i tool restano nel repo principale.
- Rimandato il runner staccato fuori da Pi: è l'evoluzione per CI e Proxmox.
- Prossimo passo: implementazione e banco `eval/auto/` di 5 goal (≥ 7/10).

## Decisione
[ADR 0001 — un processo figlio `pi -p` per passo, nel worktree](../../adr/0001-auto-mode-processo-figlio-per-passo.md)

## Spesa
- Subagenti: 2 critici `pi -p` con haiku. Il tool `subagent` non era disponibile.
- Fonti lette: 11 primarie per il territorio, più la documentazione di Pi e Claude Code.
- Repo studiati: 4.
- Misure: 7 chiamate haiku.
- Profilo: default.

## Ignoto chiuso
Tutte le 20 righe di `90-ignoto.md` hanno uno stato:
- risolte: 1, 3, 5, 11, 13, 16, 19;
- risolta in parte, il resto nell'ADR: 10;
- nell'ADR: 12, 17, 18, 20;
- differite al banco o all'implementazione, con motivo: 2, 4, 6, 7, 8, 9, 14, 15.

## File
`00-brief.md`, `05-territorio.md`, `10-ricerca.md`, `20-repo/`, `20-confronto.md`, `30-alternative.md`, `30-critico-{1,2}.md`, `90-ignoto.md`; misure in `eval/auto/REPORT.md`.
