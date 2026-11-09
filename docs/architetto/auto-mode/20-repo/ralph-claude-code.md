# frankbria/ralph-claude-code

## Source Register
| Campo | Valore |
|---|---|
| Repository | https://github.com/frankbria/ralph-claude-code |
| Commit | 11f9df5becc8093ff2265542107e8e53a42e9970 (2026-11-04) |
| Letto il | 2026-11-09 |
| Canale di lettura | gh api + download dei singoli file |
| Licenza | MIT — copiabile: sì |
| Dimensione | 1610 KB; `ralph_loop.sh` 170 KB, 66 file di test |

## Salute
| Segnale | Valore | Fonte |
|---|---|---|
| Ultimo push | 2026-11-07 | gh api |
| Release | nessuna pubblicata | gh api |
| Contributori | 31, primo 73% | gh api |
| Issue aperte | 11 | gh api |
| Scorecard | non disponibile | api.securityscorecards.dev |
| Advisory | unknown | — |

## Cosa risolve e per chi
Ciclo autonomo in Bash attorno a `claude -p`: legge `.ralph/PROMPT.md` e `.ralph/fix_plan.md`, ripete finché il modello dichiara il lavoro finito, con limiti di chiamate orari e un interruttore automatico (circuit breaker). Per chi usa Claude Code da terminale.

## Architettura
| Aspetto | Come fa | Evidenza | Profondità |
|---|---|---|---|
| Confini | un unico script `ralph_loop.sh` (170 KB) più librerie Bash in `lib/` | albero del repo | fonte legata |
| Contesto | **di default riprende la stessa sessione** (`CLAUDE_USE_CONTINUE=true`, `--resume <id>`, scadenza 24 h): non è il Ralph a contesto nuovo | [ralph_loop.sh#L120](https://github.com/frankbria/ralph-claude-code/blob/11f9df5becc8093ff2265542107e8e53a42e9970/ralph_loop.sh#L120), #L1688-L1693, #L178 | implementazione letta |
| Stato | file in `.ralph/` (`.circuit_breaker_state`, `.exit_signals`, `.response_analysis`, `.ralph_session`), `fix_plan.md` con caselle | [lib/circuit_breaker.sh#L17-L19](https://github.com/frankbria/ralph-claude-code/blob/11f9df5becc8093ff2265542107e8e53a42e9970/lib/circuit_breaker.sh#L17-L19), ralph_loop.sh#L203 | implementazione letta |
| Arresto per stallo | interruttore a tre stati (CLOSED/HALF_OPEN/OPEN): si apre dopo 3 giri senza progresso, 5 con lo stesso errore, 2 con permessi negati, o calo dell'output >70%; riprova dopo 30 min | [lib/circuit_breaker.sh#L11-L27](https://github.com/frankbria/ralph-claude-code/blob/11f9df5becc8093ff2265542107e8e53a42e9970/lib/circuit_breaker.sh#L11-L27), #L269-L295 | implementazione letta |
| Progresso | file cambiati (`git diff`) **oppure** segnale di completamento **oppure** file dichiarati dal modello nel blocco `RALPH_STATUS` | lib/circuit_breaker.sh#L174-L190 | implementazione letta |
| Arresto per completamento | «doppia condizione»: ≥2 indicatori di completamento recenti **e** `EXIT_SIGNAL: true` dichiarato dal modello; uscita forzata dopo 5 `EXIT_SIGNAL` di fila | [ralph_loop.sh#L1065-L1087](https://github.com/frankbria/ralph-claude-code/blob/11f9df5becc8093ff2265542107e8e53a42e9970/ralph_loop.sh#L1065-L1087) | implementazione letta |
| Budget | `MAX_CALLS_PER_HOUR=100`, `MAX_TOKENS_PER_HOUR` (spento di default), rilevamento del `rate_limit_event` rifiutato nello stream JSON | ralph_loop.sh#L111-L112, #L2513 | implementazione letta |
| Permessi | lista `--allowedTools` di Claude Code; **il default include `git push *`, `git merge *`, `git checkout *`, `npm *`** | [ralph_loop.sh#L119](https://github.com/frankbria/ralph-claude-code/blob/11f9df5becc8093ff2265542107e8e53a42e9970/ralph_loop.sh#L119) | implementazione letta |
| Protezione dei file | controlla solo che i file di Ralph esistano, non che non vengano modificati | [lib/file_protection.sh](https://github.com/frankbria/ralph-claude-code/blob/11f9df5becc8093ff2265542107e8e53a42e9970/lib/file_protection.sh) | implementazione letta |
| Test | 66 file in `tests/` (bats) | albero | fonte legata |

## Dolori (issue, PR rifiutate, fork)
| Dolore | Evidenza | Che cosa insegna |
|---|---|---|
| «Ralph has completed the project!… but it hasn't»: uscita prematura perché i contatori di completamento restavano tra una sessione e l'altra | https://github.com/frankbria/ralph-claude-code/issues/91 (9 commenti) | Il completamento dichiarato dal modello non basta; lo stato dei segnali va azzerato a ogni avvio. Da noi: fine solo quando tutti i `passes` sono veri e i check congelati passano. |
| Permessi negati a ripetizione; la risposta del manutentore è allargare `ALLOWED_TOOLS` | https://github.com/frankbria/ralph-claude-code/issues/178, #154 | Una lista bianca stretta spinge l'utente ad aprirla tutta: altro motivo per la lista nera più rete spenta. |
| File dell'ID di sessione corrotto dopo ~18 giri (`>>` invece di `>`) | https://github.com/frankbria/ralph-claude-code/issues/227 | Lo stato su file va scritto in modo atomico. |
| Errore aritmetico quando `fix_plan.md` non ha caselle | https://github.com/frankbria/ralph-claude-code/issues/255 | Il piano in Markdown è fragile da analizzare: meglio JSON. |
| Il file di stato è committabile e `$((x+0))` eseguiva codice | commento in lib/circuit_breaker.sh#L166-L167 (issue #371) | Lo stato letto dal repo è input non fidato. |

## Comportamento eseguito
non eseguito: avvia `claude -p` in ciclo e consuma quota.

## Cosa copiare
- Interruttore automatico con soglie separate (nessun progresso 3, stesso errore 5, permessi negati 2) — lib/circuit_breaker.sh#L22-L25 — MIT. Da noi già in parte in `goal.ts` (2 continuazioni senza tool).
- Lettura del `rate_limit_event` nello stream JSON per fermarsi al limite della finestra — ralph_loop.sh#L2513.
- Azzeramento dei segnali di uscita a ogni nuova sessione (correzione di #91).

## Cosa evitare
- Fine del lavoro decisa da una dichiarazione del modello (`EXIT_SIGNAL`, `STATUS: COMPLETE` conta come progresso anche senza modifiche).
- `git push` e `git merge` permessi di default.
- Sessione ripresa per giorni: il contesto cresce e si perde il vantaggio di Ralph.
- Script unico da 170 KB in Bash.

## Giudizio
Utile soprattutto per le condizioni di arresto e per i dolori raccolti dagli utenti; il modello di permessi e la ripresa della sessione vanno nella direzione opposta alle nostre decisioni N1 e N3. Fiducia alta sui fatti letti, media sul giudizio. Prossimo controllo più economico: leggere `lib/response_analyzer.sh` per vedere come distingue un giro «solo test» (`test_only_loops`).
