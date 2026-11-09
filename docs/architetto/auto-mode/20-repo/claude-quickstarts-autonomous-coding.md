# claude-quickstarts / autonomous-coding

## Source Register
| Campo | Valore |
|---|---|
| Repository | https://github.com/anthropics/claude-quickstarts (cartella `autonomous-coding/`) |
| Commit | 4a4224bdf0e9cfb3332167b69c90457403813625 (2026-11-06) |
| Letto il | 2026-11-09 |
| Canale di lettura | gh api (file singoli) |
| Licenza | MIT — copiabile: sì |
| Dimensione | 5848 KB (tutto il repo) |

## Salute
| Segnale | Valore | Fonte |
|---|---|---|
| Ultimo push | 2026-11-06 | gh api |
| Release | nessuna | gh api |
| Contributori | 33, primo 25% | gh api |
| Issue aperte | 238 (repo intero) | gh api |
| Scorecard | non disponibile | api.securityscorecards.dev |
| Advisory | unknown | — |

## Cosa risolve e per chi
Implementazione di riferimento dell'articolo Anthropic «Effective harnesses for long-running agents» ([A1] del territorio): costruisce un'app web da una specifica (`prompts/app_spec.txt`) in più sessioni, con l'Agent SDK in Python.

## Architettura
| Aspetto | Come fa | Evidenza | Profondità |
|---|---|---|---|
| Ciclo | `while True`: un client nuovo (contesto vuoto) per iterazione; prima sessione con il prompt dell'inizializzatore, poi sempre il prompt di codifica; 3 s tra un giro e l'altro | [agent.py#L144-L186](https://github.com/anthropics/claude-quickstarts/blob/4a4224bdf0e9cfb3332167b69c90457403813625/autonomous-coding/agent.py#L144-L186) | implementazione letta |
| Arresto | solo `--max-iterations`; **nessun arresto quando tutte le feature passano** | agent.py#L149-L153 | implementazione letta |
| Stato | `feature_list.json` (lista con `passes`), `claude-progress.txt`, git | [progress.py#L12-L35](https://github.com/anthropics/claude-quickstarts/blob/4a4224bdf0e9cfb3332167b69c90457403813625/autonomous-coding/progress.py#L12-L35) | implementazione letta |
| Anti-cheating | «YOU CAN ONLY MODIFY ONE FIELD: "passes"», «NEVER remove tests»: **solo nel prompt**, nessun controllo nel codice | [coding_prompt.md#L106-L126](https://github.com/anthropics/claude-quickstarts/blob/4a4224bdf0e9cfb3332167b69c90457403813625/autonomous-coding/prompts/coding_prompt.md#L106-L126) | implementazione letta |
| Smoke test | passo 3 obbligatorio: rieseguire 1–2 feature già `passes: true` prima di toccarne una nuova; se falliscono, rimetterle a `false` | coding_prompt.md#L46-L57 | implementazione letta |
| Un elemento per giro | passo 4: una sola feature per sessione, la più prioritaria non passata | coding_prompt.md#L69-L73 | implementazione letta |
| Verifica | passo 6: automazione del browser con screenshot prima di `passes: true` | coding_prompt.md#L84-L126 | implementazione letta |
| Permessi | tre strati: sandbox del sistema operativo di Claude Code (`sandbox.enabled`), permessi di file solo `./**`, hook `PreToolUse` su Bash con **lista bianca** di 18 comandi (`ls cat grep cp mkdir chmod npm node git ps lsof sleep pkill init.sh…`), `pkill` e `chmod` validati a parte | [security.py#L15-L44](https://github.com/anthropics/claude-quickstarts/blob/4a4224bdf0e9cfb3332167b69c90457403813625/autonomous-coding/security.py#L15-L44), [client.py#L67-L80](https://github.com/anthropics/claude-quickstarts/blob/4a4224bdf0e9cfb3332167b69c90457403813625/autonomous-coding/client.py#L67-L80) | implementazione letta |
| Test come specifica | `test_security.py` | presente, non letto | fonte legata |

## Dolori (issue, PR rifiutate, fork)
| Dolore | Evidenza | Che cosa insegna |
|---|---|---|
| La lista bianca si aggira con un a capo o `$(…)` come argomento di un comando permesso (`shlex` vede uno spazio, la shell un comando nuovo) | https://github.com/anthropics/claude-quickstarts/pull/496 (aperta), #497 (chiusa) | Un parser di comandi in lista bianca o nera fa acqua; serve un confine sotto (sandbox, rete spenta). Inoltre `node` e `npm` permessi equivalgono a «tutto permesso». |
| `is_first_run` azzerato prima che l'inizializzatore finisca: se fallisce, i giri dopo saltano il setup | https://github.com/anthropics/claude-quickstarts/pull/541 (aperta) | La fase si decide dallo stato su disco a ogni giro, non da una variabile in memoria. |
| Limite di iterazioni non positivo accettato | https://github.com/anthropics/claude-quickstarts/pull/470 | Validare gli argomenti del ciclo. |
| Richiesta di input dell'utente in tempo reale durante il ciclo | https://github.com/anthropics/claude-quickstarts/issues/327 | Serve un canale per correggere la rotta senza fermare tutto (da noi: lista «da approvare», `/auto` con messaggi). |
| Parallelizzare gli agenti | https://github.com/anthropics/claude-quickstarts/issues/320 | Domanda aperta, nessuna risposta: conferma la scelta di un agente solo. |

## Comportamento eseguito
non eseguito: richiede `ANTHROPIC_API_KEY` (API a pagamento) e la prima sessione dura 10–20 minuti (README).

## Cosa copiare
- Prompt di codifica a 10 passi (orientamento, smoke test, una feature, verifica reale, solo `passes`, commit, note, chiusura pulita) — `prompts/coding_prompt.md` — MIT.
- Scelta della fase dallo stato su disco (`feature_list.json` esiste?) — agent.py#L126, corretto da #541.
- Validatori dedicati per comandi rischiosi ma utili (`pkill` solo su processi di sviluppo, `chmod` solo `+x`) — security.py#L161-L250.

## Cosa evitare
- Vincolo «solo `passes`» affidato al prompt: METR mostra che i modelli modificano test e valutatori ([M1]). Da noi va nel codice (N2).
- Lista di comandi analizzata con `shlex` come unico confine (#496).
- Ciclo senza arresto a completamento: consuma fino al limite.

## Giudizio
Riferimento più vicino al nostro N1/N2/N4 (contesto nuovo, JSON con `passes`, smoke test), ma i vincoli sono nel prompt e la sicurezza poggia sulla sandbox di Claude Code, che Pi non ha. Fiducia alta. Prossimo controllo più economico: leggere `test_security.py` per ricavare casi di test della nostra lista nera.
