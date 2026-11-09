# mikeyobrien/ralph-orchestrator

## Source Register
| Campo | Valore |
|---|---|
| Repository | https://github.com/mikeyobrien/ralph-orchestrator |
| Commit | 64040fd0cda4d83386e4d1d1aa65571dadfe00b3 (2026-11-06) |
| Letto il | 2026-11-09 |
| Canale di lettura | gh api + raw.githubusercontent.com (file singoli) |
| Licenza | MIT — copiabile: sì |
| Dimensione | 14180 KB; Rust 5,5 MB, TypeScript 0,9 MB |

## Salute
| Segnale | Valore | Fonte |
|---|---|---|
| Ultimo push | 2026-11-06 | gh api |
| Release (ultime 3) | v2.10.1 (2026-06-23), v2.10.0 (2026-06-22), v2.9.3 (2026-05-08) | gh api |
| Contributori | 38, primo 84% | gh api |
| Issue aperte | 38 | gh api |
| Scorecard | non disponibile | api.securityscorecards.dev |
| Advisory | unknown | — |

## Cosa risolve e per chi
> «A hat-based orchestration framework that keeps AI agents in a loop until the task is done.» — `README.md:13`, letto 2026-11-09

Orchestratore in Rust per più backend (Claude Code, Gemini CLI, Codex, OpenCode…): «cappelli» (ruoli) che si passano eventi, cicli paralleli in worktree con coda di merge, «backpressure» (gate su test, lint, typecheck), memoria persistente, interfaccia TUI, web e Telegram per l'intervento umano.

## Architettura
| Aspetto | Come fa | Evidenza | Profondità |
|---|---|---|---|
| Confini | workspace Cargo: `ralph-core`, `ralph-cli`, `ralph-adapters`, `ralph-tui`, `ralph-telegram`, `ralph-api`, più web in TypeScript | albero del repo | fonte legata |
| Arresto | 13 motivi tipizzati con codici d'uscita: completamento, `max_iterations`, `max_runtime`, `max_cost`, fallimenti consecutivi, thrashing (3 ridispacci di compiti abbandonati), stallo (stessa firma di evento 3 volte), 3 righe JSONL malformate, file `.ralph/stop-requested`, worktree sparito | [event_loop/mod.rs#L636-L700](https://github.com/mikeyobrien/ralph-orchestrator/blob/64040fd0cda4d83386e4d1d1aa65571dadfe00b3/crates/ralph-core/src/event_loop/mod.rs#L636-L700), #L106-L146 | implementazione letta |
| Completamento | `LOOP_COMPLETE` rifiutato se mancano eventi di fase obbligatori, se c'è una guida umana non letta, o se i task o lo scratchpad non risultano completi | mod.rs#L755-L830 | implementazione letta |
| Backpressure | `build.done` accettato solo se il testo dell'evento contiene `tests: pass`, `lint: pass`, `typecheck: pass`…; altrimenti si genera `build.blocked`. **L'evidenza è scritta dal modello**: lo script cerca la stringa, non riesegue i comandi | [mod.rs#L2577-L2640](https://github.com/mikeyobrien/ralph-orchestrator/blob/64040fd0cda4d83386e4d1d1aa65571dadfe00b3/crates/ralph-core/src/event_loop/mod.rs#L2577-L2640), [event_parser.rs#L322-L336](https://github.com/mikeyobrien/ralph-orchestrator/blob/64040fd0cda4d83386e4d1d1aa65571dadfe00b3/crates/ralph-core/src/event_parser.rs#L322-L336) | implementazione letta |
| Worktree | un worktree per ciclo parallelo; alla creazione copia i file non tracciati e modificati; aggiunge la cartella dei worktree a `.gitignore`; gestisce i symlink | [worktree.rs#L1-L5](https://github.com/mikeyobrien/ralph-orchestrator/blob/64040fd0cda4d83386e4d1d1aa65571dadfe00b3/crates/ralph-core/src/worktree.rs#L1-L5), #L193-L210, #L371-L426, #L531-L560 | implementazione letta |
| Coda di merge | log JSONL in sola aggiunta `.ralph/merge-queue.jsonl` con `flock()`, stato ricavato dagli eventi; a fine ciclo in worktree: in coda se auto-merge, altrimenti il worktree resta per il merge manuale | [merge_queue.rs#L1-L12](https://github.com/mikeyobrien/ralph-orchestrator/blob/64040fd0cda4d83386e4d1d1aa65571dadfe00b3/crates/ralph-core/src/merge_queue.rs#L1-L12), [loop_completion.rs#L1-L12](https://github.com/mikeyobrien/ralph-orchestrator/blob/64040fd0cda4d83386e4d1d1aa65571dadfe00b3/crates/ralph-core/src/loop_completion.rs#L1-L12) | implementazione letta |
| Stato | cartella `.ralph/` (eventi JSONL, task, memorie, scratchpad, coda di merge) | moduli `task_store.rs`, `memory_store.rs`, `loop_history.rs` | fonte legata |
| Test come specifica | `event_loop/tests.rs` (175 KB), crate `ralph-e2e` con scenari Gherkin, cassette registrate, banco `bench/tasks` | albero | fonte legata |

## Dolori (issue, PR rifiutate, fork)
| Dolore | Evidenza | Che cosa insegna |
|---|---|---|
| «ralph looping to infinity» su `ralph run -p "Say hi"`; causa probabile la mancanza dello scratchpad di default | https://github.com/mikeyobrien/ralph-orchestrator/issues/157 (14 commenti) | Anche un goal banale deve terminare: serve un percorso «niente da fare» e un tetto rigido. |
| «Loop done when tasks are incomplete»: `LOOP COMPLETED` dopo 3–4 compiti su 15 | https://github.com/mikeyobrien/ralph-orchestrator/issues/123 (14 commenti) | Stesso dolore di frankbria #91: il completamento dichiarato dal modello non regge. Da qui i controlli aggiunti in mod.rs#L755-L830. |
| `ralph run` fermo indefinitamente | https://github.com/mikeyobrien/ralph-orchestrator/issues/105 | Timeout per passo. |
| Supporto Windows | https://github.com/mikeyobrien/ralph-orchestrator/issues/120 | Piattaforme diverse costano: da noi l'isolamento di rete è solo Linux/WSL per ora. |
| Non si può dare una direzione con `-p` | https://github.com/mikeyobrien/ralph-orchestrator/issues/266 | Il canale umano a ciclo avviato serve davvero. |

## Comportamento eseguito
non eseguito: richiede l'installazione del binario (npm o cargo) e un backend con quota.

## Cosa copiare
- Motivi di arresto tipizzati con codice d'uscita, verificati in un'unica funzione a ogni giro — mod.rs#L636-L700 — MIT. In particolare stallo (stessa firma 3 volte), thrashing e worktree sparito.
- Arresto con un file sentinella (`.ralph/stop-requested`): un modo semplice per fermare il ciclo da fuori.
- Rifiuto del completamento se mancano fasi obbligatorie o se c'è un messaggio umano non letto — mod.rs#L755-L775.
- Coda di merge come log JSONL in sola aggiunta con `flock` (da noi c'è già il lock di `land.ts`).

## Cosa evitare
- Backpressure basata su stringhe scritte dal modello (`tests: pass`): è lo stesso cheating di METR. Da noi i check congelati li riesegue il codice.
- Superficie enorme (5,5 MB di Rust, web, Telegram, MCP): l'opposto del mantra di Pi.

## Giudizio
Il più completo e il più curato sui motivi di arresto e sui worktree; la verifica però si fida di ciò che scrive il modello. Da copiare le idee, non il codice (Rust contro TypeScript). Fiducia media: letti 5 file su un repo molto grande. Prossimo controllo più economico: leggere `testing/smoke_runner.rs` per vedere se esiste una verifica eseguita dal codice.
