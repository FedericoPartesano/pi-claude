# Auto mode: Pi che porta a termine un goal in autonomia
Aggiornato: 2026-11-09 · fase 6 · profilo: default · tema: agenti-autonomi

## Problema e contesto
`/goal` (`extensions/goal.ts`) tiene Pi al lavoro finché `goal_done` non passa con i check verdi, ma l'intent, il piano e le decisioni li prepara e li prende l'utente. Auto mode è l'evoluzione: dato un goal, Pi scrive l'intent, pianifica, implementa, verifica e consegna senza intervento, usando le skill di `skills/phases.json` fase per fase. Se non si fa nulla, ogni goal di mezza giornata richiede la presenza dell'utente a ogni bivio.

Comando nuovo `/auto <goal>`, costruito sul meccanismo di `goal.ts` (continuazioni, check, soglia d'uso della finestra 5h), riusato e non duplicato.

## Risultato atteso
L'utente scrive un goal di taglia media (circa mezza giornata di lavoro umano), si allontana e al ritorno trova intent, piano, codice con check verdi in piccoli commit su un branch dedicato e un rapporto con decisioni e prove, senza alcun intervento, in almeno 7 casi su 10.

## Modo di fallimento
Nelle prime 5 esecuzioni reali, almeno uno di questi: consumo oltre il 30% della finestra 5h senza finire; continuazioni senza progresso misurabile; una decisione che l'utente deve disfare a mano; un'azione distruttiva fuori dal branch.

## Vincoli duri
- Stack: estensione Pi in TypeScript (Node ≥ 22.19, strip-only), provider `claude-code` sull'abbonamento; nessuna dipendenza nuova.
- Piattaforme: WSL, Linux, macOS, Windows.
- Costo fisso di prompt zero quando auto mode è spento; iniezioni ≤ 1500 caratteri.
- Licenze accettabili per codice copiato: MIT, Apache-2.0, BSD.
- Mantra di Pi: prima i token, poi velocità e leggerezza.

## Decisioni dell'intervista
1. **Comando**: `/auto <goal>` sopra `goal.ts`.
2. **Decisioni**: Pi decide da solo, usando `doubt-driven-development` solo per le scelte architetturali e per quelle che toccano il gate. Il gate copre le azioni irreversibili o costose: push, cancellazioni, dipendenze nuove, chiamate a pagamento. Ogni decisione va nel registro con le alternative scartate.
3. **Azioni del gate**: vanno in una lista «da approvare» e Pi prosegue con il lavoro indipendente; se tutto ciò che resta dipende da quell'azione, sceglie un'alternativa senza l'azione e lo annota.
4. **Git**: branch `auto/<slug>`, piccoli commit Conventional; mai push né merge su `main`; il merge si propone alla fine. Il lancio di `/auto` vale come richiesta di commit, solo su quel branch.
5. **Isolamento**: `git worktree` separato.
6. **Budget e arresto**: oltre ai limiti di `goal.ts`, tetto del 50% della finestra 5h e di 3 h, entrambi configurabili. Arresto dopo 3 fasi senza nuovi check verdi né commit. Il rapporto si scrive anche quando Pi si ferma.
7. **Skill**: si inietta una volta il `SKILL.md` della fase all'ingresso (define, plan, build, verify, review, ship); non tutte, non a ogni turno.
8. **Agente**: un solo Pi a fasi nella prima versione; `pi-team` resta come evoluzione, da decidere coi dati.
9. **Check**: si congelano a fine plan. Ogni modifica successiva va nel registro col motivo. Prima di partire, una rilettura indipendente in contesto pulito (`code-review-and-quality`).
10. **Sicurezza**: limiti nel codice (estensione guards), non solo nel prompt. Vietati `git push`, `sudo`, `curl … | sh`, `rm` e scritture fuori dal worktree. Il testo preso dal web non decide mai un comando.
11. **Contesto e ripresa** (rivista dopo il territorio, N1; forma fissata in fase 5, ADR 0001): un processo figlio `pi -p --no-extensions` per ogni passo del piano, con cwd nel worktree, guidato da un supervisore nel Pi dell'utente; lo stato vive in file nel worktree (fase, piano, requisiti, decisioni, azioni in attesa, budget speso) e in git. `/auto resume` riparte dal passo successivo all'ultimo commit.
12. **Avvisi**: campanella del terminale; notifica Windows da WSL via `powershell.exe`, da provare su Windows a cura dell'utente.
13. **Modello per fase**: `phases.json` può indicarlo; di default è vuoto, quindi vale il modello scelto all'avvio (#r34).
14. **Rapporto**: l'intent stesso (`intents/<data>-<slug>.md`), con status, prove e una sezione «Decisioni»; il pannello `alt+s` mostra fase e budget. Nessun altro file oltre al file di stato.
15. **Misura**: banco `eval/auto/` con 5 goal di taglia media presi da `todos/` e con check noti. Un giro per versione, esito nel report anche se negativo, via libera dell'utente prima di ogni giro.
16. **Anti-cheating** (N2): `auto/requisiti.json` con solo `passes` modificabile; scritture su check e test congelati bloccate nel codice durante build.
17. **Permessi** (N3; rivista in fase 5, ADR 0001): lista nera nel codice ricavata dalle regole di blocco di Claude Code auto mode; comandi bash dentro `bwrap` dove c'è (filesystem in sola lettura fuori dal worktree, rete spenta), altrimenti `unshare -rn`; web e rete in uscita spenti da build in poi, web in sola lettura in define/plan; pacchetti dichiarati installati prima di build.
18. **Verifica end-to-end** (N4): smoke test a inizio passo; prova d'uso reale per ogni requisito prima di `passes: true`.

## Scenari di qualità
| Scenario | Misura | Peso | Portante |
|---|---|---|---|
| Completamento autonomo | ≥ 7/10 goal del banco chiusi con check verdi senza intervento | 5 | sì |
| Sicurezza | 0 comandi vietati eseguiti, anche con prompt injection di prova nel banco | 5 | sì |
| Costo | goal medio ≤ 30% della finestra 5h; costo fisso di prompt a riposo = 0 token | 4 | sì |
| Niente giri a vuoto | arresto entro 3 fasi senza progresso; mai continuazioni senza tool oltre i limiti di `goal.ts` | 4 | no |
| Ripresa | `/auto resume` dopo un crash riparte dalla fase giusta senza rifare commit | 3 | no |
| Decisioni leggibili | ogni decisione nel rapporto con alternativa scartata e motivo | 3 | no |
| Leggerezza | nessun timer né lavoro per frame aggiunto alla UI; worktree creato in ≤ 10 s | 2 | no |

## Ipotesi da smontare e candidata dichiarata
- Candidata dichiarata: un solo agente a fasi, macchina a stati sopra `goal.ts`, skill iniettate all'ingresso di ogni fase, gate nel codice.
- Da verificare: che basti un agente singolo per goal di mezza giornata senza perdersi tra le compattazioni; che `doubt-driven-development` valga il suo costo; che un worktree sia economico con questi `node_modules`.

## Riferimenti amati / odiati
Da studiare in fase 2–3: auto mode di Claude Code (classificatore dei permessi), Devin, OpenHands, Aider architect, Ralph loop. `affaan-m/ecc` autonomous-loops già scartato come skill. Odiato: costo fisso nel prompt.

## Fuori perimetro e anti-obiettivi
Più repo insieme, deploy, interfaccia dedicata nel prototipo oltre a barra e pannello esistenti, esecuzione pianificata (cron). Anti-obiettivo: un qualsiasi costo fisso di prompt con auto mode spento.

## Decisioni già prese (ADR letti)
Nessun ADR nel repo. Dallo studio `agent-skills-integrate`: skill nascoste fuori da auto mode, mappa fase → skill in `skills/phases.json`, `doubt-driven-development` come freno (qui ristretto alle decisioni del gate e architetturali). Dalle preferenze: commit solo su richiesta (qui soddisfatta dal lancio di `/auto`, solo sul branch), scelta del modello manuale (#r34).
