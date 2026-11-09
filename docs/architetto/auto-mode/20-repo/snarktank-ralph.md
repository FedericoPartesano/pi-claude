# snarktank/ralph

## Source Register
| Campo | Valore |
|---|---|
| Repository | https://github.com/snarktank/ralph |
| Commit | 6c53cb0b831ebe8739c6a003e22af14902d8b0b5 (2026-02-02) |
| Letto il | 2026-11-09 |
| Canale di lettura | gh api + raw.githubusercontent.com |
| Licenza | MIT — copiabile: sì |
| Dimensione | 4705 KB (quasi tutto immagini); `ralph.sh` 3,5 KB, `prompt.md` 4,2 KB |

## Salute
| Segnale | Valore | Fonte |
|---|---|---|
| Ultimo push | 2026-02-02 (9 mesi fa) | gh api |
| Release | nessuna | gh api |
| Contributori | 4, primo 45% | gh api |
| Issue aperte | 75 | gh api |
| Scorecard | non disponibile | api.securityscorecards.dev |
| Advisory | unknown | — |

## Cosa risolve e per chi
Il Ralph minimo e più diffuso (22k stelle): un ciclo `for` che rilancia l'agente (Amp o Claude Code) con lo stesso prompt finché `prd.json` è tutto `passes: true`. Due skill (`prd`, `ralph`) generano il PRD e lo convertono in JSON.

## Architettura
| Aspetto | Come fa | Evidenza | Profondità |
|---|---|---|---|
| Ciclo | `for i in 1..MAX_ITERATIONS` (default 10): un processo nuovo dell'agente per giro, quindi contesto nuovo; 2 s tra i giri | [ralph.sh#L84-L108](https://github.com/snarktank/ralph/blob/6c53cb0b831ebe8739c6a003e22af14902d8b0b5/ralph.sh#L84-L108) | implementazione letta |
| Arresto | il modello scrive `<promise>COMPLETE</promise>` quando crede che tutte le storie passino; lo script cerca la stringa nell'output | ralph.sh#L98-L104, [prompt.md#L96-L101](https://github.com/snarktank/ralph/blob/6c53cb0b831ebe8739c6a003e22af14902d8b0b5/prompt.md#L96-L101) | implementazione letta |
| Stato | `prd.json` (storie con `acceptanceCriteria`, `priority`, `passes`, `notes`, `branchName`), `progress.txt` in sola aggiunta con una sezione «Codebase Patterns» in testa, `AGENTS.md` nelle cartelle, git | [prd.json.example](https://github.com/snarktank/ralph/blob/6c53cb0b831ebe8739c6a003e22af14902d8b0b5/prd.json.example), prompt.md#L8-L74 | implementazione letta |
| Archivio | se `branchName` cambia, copia `prd.json` e `progress.txt` in `archive/<data>-<branch>/` e azzera il progresso | ralph.sh#L42-L65 | implementazione letta |
| Criteri | ogni storia ha criteri verificabili, sempre «Typecheck passes», e per l'interfaccia «Verify in browser» | prd.json.example | implementazione letta |
| Permessi | **nessuno**: `claude --dangerously-skip-permissions`, `amp --dangerously-allow-all` | [ralph.sh#L92-L95](https://github.com/snarktank/ralph/blob/6c53cb0b831ebe8739c6a003e22af14902d8b0b5/ralph.sh#L92-L95) | implementazione letta |
| Memoria tra giri | il modello scrive gli schemi riusabili in `progress.txt` e negli `AGENTS.md` vicini ai file toccati | prompt.md#L39-L74 | implementazione letta |
| Test | nessun test del ciclo | albero | fonte legata |

## Dolori (issue, PR rifiutate, fork)
| Dolore | Evidenza | Che cosa insegna |
|---|---|---|
| Il ciclo si blocca: `claude` non termina («No messages returned») e il giro dopo non parte; le correzioni proposte sono retry e timeout | https://github.com/snarktank/ralph/issues/32 (aperta) | Ogni passo ha bisogno di un timeout e di un retry; da noi c'è già la barra del timeout in Pi. |
| Riavviare per ogni storia butta il ragionamento del modello; proposta di controllare `prd.json` invece dell'output | https://github.com/snarktank/ralph/issues/91, PR #93 | Il completamento va letto dallo stato su disco, non dall'output; il ragionamento utile va scritto nei file. |
| Visibilità del progresso | https://github.com/snarktank/ralph/issues/88 | Serve una vista dello stato del ciclo (da noi: barra di stato e intent). |

## Comportamento eseguito
non eseguito: avvia l'agente con i permessi spenti e consuma quota.

## Cosa copiare
- Formato di `prd.json` (id, criteri di accettazione, priorità, `passes`, note, `branchName`) — prd.json.example — MIT. Base per `auto/requisiti.json` (N2).
- «Codebase Patterns» in testa al file di progresso: la memoria tra giri resta corta e si legge per prima — prompt.md#L39-L48.
- Archiviazione dello stato al cambio di branch — ralph.sh#L42-L65.

## Cosa evitare
- Permessi spenti del tutto.
- Arresto deciso da una stringa scritta dal modello.
- Ciclo senza timeout per giro (#32).

## Giudizio
La forma più semplice del modello che abbiamo scelto con N1: processo nuovo per giro, stato in JSON e git. Mostra quanto serve poco codice, ma è fermo da 9 mesi e non ha protezioni. Fiducia alta. Prossimo controllo più economico: leggere `skills/prd/SKILL.md` per la conversione da goal a storie (la nostra fase plan).
