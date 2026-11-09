# Confronto dei repo
Aggiornato: 2026-11-09 · fase 3

Problema: ciclo autonomo che porta un goal a termine (piano, implementazione, verifica) con contesto nuovo per passo, stato su disco, permessi e arresto sicuri. Stack: TypeScript, estensione di Pi, provider `claude -p`. Licenze accettabili: MIT, Apache-2.0, BSD (assunto). N = 4, scelti dall'utente il 2026-11-09. Profili in `20-repo/`.

| | claude-quickstarts/autonomous-coding | frankbria/ralph-claude-code | snarktank/ralph | ralph-orchestrator |
|---|---|---|---|---|
| Approccio | Agent SDK Python, inizializzatore + agente di codifica | Bash attorno a `claude -p`, circuit breaker | 113 righe di Bash + prompt | Rust, cappelli ed eventi, worktree paralleli |
| Contesto per giro | nuovo | **ripreso** (`--resume`, 24 h) | nuovo | nuovo per iterazione (eventi su disco) |
| Stato | `feature_list.json` + `claude-progress.txt` + git | `.ralph/` + `fix_plan.md` (Markdown) | `prd.json` + `progress.txt` + `AGENTS.md` + git | `.ralph/` JSONL (eventi, task, memorie) |
| Fine del lavoro | nessuna (solo `--max-iterations`) | dichiarata dal modello (`EXIT_SIGNAL` ×2) | dichiarata dal modello (`<promise>COMPLETE`) | dichiarata dal modello, ma rifiutata se mancano fasi o task |
| Verifica | prompt: smoke test + browser con screenshot | prompt: test essenziali, ~20% dello sforzo | prompt: typecheck + browser | stringhe `tests: pass` scritte dal modello |
| Anti-cheating nel codice | no (solo prompt) | no | no | no |
| Permessi | sandbox OS + file `./**` + lista bianca Bash (aggirabile, PR #496) | `--allowedTools`, default con `git push`/`merge` | nessuno (`--dangerously-skip-permissions`) | delegati al backend |
| Arresto per stallo | no | sì: 3 senza progresso, 5 stesso errore, 2 permessi negati | no | sì: 13 motivi tipizzati, stallo a 3 firme uguali |
| Budget | no | 100 chiamate/ora, `rate_limit_event` | 10 iterazioni | iterazioni, tempo, costo in dollari |
| Worktree | no | no | branch da `prd.json` | sì, con copia dei non tracciati e coda di merge JSONL |
| Licenza / copiabile | MIT / sì | MIT / sì | MIT / sì | MIT / sì (ma Rust) |
| Salute | attivo, 33 contributori | attivo, 1 autore al 73% | fermo da 9 mesi | attivo, release v2.10, 1 autore all'84% |
| Dolore principale | lista bianca aggirabile con `\n` e `$(…)` | uscita prematura (#91) | ciclo bloccato senza timeout (#32) | uscita prematura (#123), ciclo infinito (#157) |
| Cosa copiare | prompt a 10 passi; fase scelta dallo stato su disco | soglie del circuit breaker; `rate_limit_event` | formato `prd.json`; «Codebase Patterns» | motivi di arresto tipizzati; file sentinella di stop; rifiuto del completamento |

## Lettura trasversale
- **Nessuno dei quattro vincola nel codice ciò che il modello può cambiare** (requisiti, test, `passes`): tutti si affidano al prompt. N2 (blocco nel codice) e i check congelati rieseguiti dal codice non hanno un riferimento da copiare: vanno progettati.
- **Il dolore più ripetuto è la fine dichiarata dal modello**: frankbria #91 e ralph-orchestrator #123, entrambi con 14 e 9 commenti. La regola che ne segue: il lavoro è finito solo quando lo stato su disco lo dice (tutti i `passes` veri) e i check congelati passano rieseguiti dal codice.
- **Contesto nuovo per giro** è la scelta di tre su quattro; frankbria riprende la sessione e ne paga il prezzo con stato corrotto e contatori sporchi tra sessioni (#91, #227). Conferma N1.
- **Sicurezza**: o permessi spenti (snarktank) o liste di comandi (quickstarts, frankbria), che si aggirano (#496) o vengono allargate dagli utenti (#178). Nessuno spegne la rete: `unshare -rn` (R2 in `10-ricerca.md`) è un vantaggio nostro.
- **Timeout per passo** manca in due su quattro e produce cicli bloccati (snarktank #32, orchestrator #105).

## Query eseguite
- `gh api repos/<o>/<r>` per mikeyobrien/ralph-orchestrator, frankbria/ralph-claude-code, snarktank/ralph, anthropics/claude-quickstarts, OpenHands/OpenHands, repomirrorhq/repomirror, SWE-agent/SWE-agent
- `gh search repos "pi-coding-agent ralph OR autonomous OR loop"`
- `gh search repos "ralph loop claude code" --sort stars`
- `gh search repos "pi extension ralph"`
- `gh search code "registerCommand ralph"`
- issue e PR dei 4 repo: `gh issue list --state all` ordinate per commenti, `gh search issues/prs --repo anthropics/claude-quickstarts "autonomous"`, `gh pr list --state closed` (snarktank)

## Canali muti
- Estensioni di Pi per cicli autonomi: nessun risultato (`gh search repos`, `gh search code`).
- Awesome list e deps.dev: non consultati (candidati sufficienti dai canali precedenti e dal territorio).
- Fork attivi: non consultati.
- Scorecard: non disponibile per nessuno dei 4.

## Scartati
- OpenHands (93k stelle): sandbox Docker e server, fuori perimetro (brief: niente sandbox, un solo agente locale).
- SWE-agent: una issue alla volta, non un goal con piano.
- repomirror: nessuna licenza dichiarata.

## Segnalazioni per l'ignoto
- Timeout per passo e retry: tutti i cicli che non ce l'hanno si bloccano (→ riga 13).
- Stato letto dal repo come input non fidato (frankbria #371, `$((x+0))` eseguiva codice) (→ riga 14).
- Piano di attività «niente da fare»: un goal banale deve terminare (orchestrator #157) (→ riga 15).

## Conoscenza
Profili copiati in `~/.architetto/conoscenza/agenti-autonomi/repo/`. Skill Repomix generate per `snarktank/ralph` e `claude-quickstarts/autonomous-coding` in `~/.architetto/conoscenza/agenti-autonomi/skills/`.
