# Ricerca esterna: progetti che gestiscono agenti in autonomia

Data: 2026-11-11. Fonti: README e codice letti con `gh api` al commit indicato.

| Progetto | ★ | Licenza | Commit | Forma |
|---|---|---|---|---|
| mikeyobrien/ralph-orchestrator | 3200 | MIT | 64040fd0cd | loop Ralph, TUI ratatui + web alpha + Telegram |
| VisionForge-OU/foreman | 439 | MIT (badge) | 92d7f7971c | TUI Textual che supervisiona `claude` stream-json |
| smtg-ai/claude-squad | 8776 | AGPL-3.0 | ce1ffb4392 | TUI tmux + worktree, più agenti |
| BloopAI/vibe-kanban | 28651 | Apache-2.0 | b4d98330da | kanban web, diff con commenti (in chiusura) |
| omnara-ai/omnara | 3384 | Apache-2.0 | 6fc7ffd705 | API + log eventi in Postgres, approvazioni |
| BimaPangestu28/agentic-tui | 1 | MIT | 225fa16195 | goal → epiche → worktree → `claude -p` → verify → merge, UI web |

## Spunti, con dove stanno

1. **Due tasti di guida distinti** (ralph, `crates/ralph-tui/src/input.rs:94-95`): `:` = guida al prossimo confine di passo, `!` = steer urgente nel passo in corso. Il writer manda `{"type":"guidance"}` o `{"type":"steer"}` sullo stdin del processo (`rpc_writer.rs:35-49`). Coincide con la nostra coda unica (decisione del giro 4) e dà già i due tasti.
2. **Steer urgente persistito su file** (ralph, `crates/ralph-core/src/urgent_steer.rs`, 111 righe): `append_message` / `take` su `urgent-steer.json`; il file sopravvive a un crash e si consuma una volta sola. Utile per il canale supervisore ↔ prototipo, voce aperta in `90-ignoto.md`.
3. **Header a larghezza adattiva** (ralph, `widgets/header.rs:36-194`): `[iter 3/60] 02:14 | hat @backend | idle: 41s | ▶ LIVE`; sotto una soglia di colonne le etichette si accorciano (`[LIVE]`→`▶`, `[REVIEW]`→`◀`). La voce «idle: Ns» è il segnale di stallo più leggibile in 5 s.
4. **Modalità LIVE / REVIEW** (ralph): frecce ←/→ scorrono i passi precedenti; il footer avvisa «▶ New: iter N» se arriva un passo nuovo mentre stai guardando uno vecchio. Costo zero quando non segui.
5. **Coda «Attention»** (foreman, `tui/app.py:260-350`): le escalation finiscono in una lista, campanello del terminale, rispondi e il worker riparte con la risposta in un contesto nuovo. Corrisponde al nostro «SERVE TE».
6. **Hint della fase con un solo tasto** (foreman, `PHASE_HINT`, `tui/app.py:27`): la dashboard dice sempre il prossimo tasto da premere. Aiuta la soglia «correggo in ≤30 s».
7. **Etichetta di esito per ogni passo** (foreman README): `success_first_try | success_after_retry(n) | evaluator_bounce | escalated(reason)`. Dà le metriche senza token.
8. **Stato tutto su file nel repo, ripartenza da disco** (foreman): già vero per `/auto` (`state.ts`); conferma la scelta.
9. **Checkout = commit + pausa, poi resume** (claude-squad, tasto `c`/`r`): risposta semplice alla «presa in mano manuale»: l'utente mette in pausa, il supervisore committa ciò che c'è, l'utente lavora nel worktree, al resume il supervisore confronta HEAD e ricalcola i requisiti.
10. **Tab anteprima / diff** (claude-squad `tab`, vibe-kanban commenti sul diff): vedere il diff del passo nella stessa vista; vibe-kanban aggiunge commenti in linea che diventano guida per l'agente.
11. **Notifiche fuori dalla vista** (ralph Telegram, tmux-ai-foreman ntfy): domande dell'agente e comandi `/status` da telefono. Da noi oggi solo toast; ntfy sarebbe un `curl` a costo zero, opzionale.
12. **Budget bar per worker** (foreman `_budget_bar`): `status cost turns` sopra il log; da noi è già la barra ▰▱ + finestra 5h.

## Cosa non prendere
- UI web separate (ralph web, agentic-tui, vibe-kanban): contro «solo prototipo» e zero dipendenze.
- Polling a intervallo (foreman `set_interval(0.5, _bell_check)`): contro «niente timer»; da noi l'evento arriva già dal loop.
- Postgres per il log eventi (omnara): `eventi.jsonl` basta.
- Più agenti in parallelo (claude-squad, foreman `max_parallel`): `/auto` è un passo alla volta per ADR 0001.

# Ricerca larga: articoli, discussioni, altri loop (2026-11-11)

Fonti lette per intero o nei commenti (HN via API Algolia; Reddit blocca le richieste, 403).

| Fonte | Tipo | Cosa porta |
|---|---|---|
| Anthropic, «Effective harnesses for long-running agents» (HN 46081704, 125 punti) | articolo | base di ADR 0001: file requisiti JSON con `passes`, un requisito per sessione, commit + file di avanzamento, test e2e d'avvio prima di lavorare |
| AnandChowdhary/continuous-claude ★1388 `898e6d956f` | repo | file di appunti condiviso come **passaggio di consegne pulito** (non un diario prolisso); tentativo fallito scartato, il fallimento guida il tentativo dopo |
| umputun/ralphex ★1514 `51f4921e92` | repo | pausa a metà passo (Ctrl+\\): annulla la sessione, l'utente modifica il piano, invio = stesso task con sessione nuova; `--review-patience=N` chiude dopo N giri senza commit; notifiche a fine/fallimento |
| steveyegge/gastown ★18763 `4b24a16e51` | repo | Witness che rileva agenti bloccati; escalation con gravità P0/P1/P2; «seance»: domanda secca a una sessione precedente |
| vercel-labs/ralph-loop-agent ★846 `8a37af8390` | repo | `completionReason` tipizzato; il feedback della verifica fallita entra nel giro dopo |
| tzachbon/smart-ralph ★567 `ac7251a0a0` | repo | `.progress.md` tenuto dopo la fine per recuperare decisioni e lezioni; task `[VERIFY]` espliciti |
| «Claude Code regularly sends each background agent's transcript» (HN 50284255, 591 punti) | discussione | i riassunti di stato dei sub-agenti (`agent_summary`, ~ogni 30 s) valgono l'8–16% dei token: conferma il vincolo «0 token per la vista» |
| OpenAI, monitoraggio degli agenti interni | articolo | i modelli sono «troppo zelanti nell'aggirare restrizioni» per raggiungere il goal; monitor asincrono che classifica per gravità |
| detail.dev, «Towards Self-Driving Codebases» (HN 49743527) + commenti | articolo | memoria delle correzioni dell'utente, altrimenti lo stesso errore si ripete; rischio opposto: un workaround registrato diventa culto e cresce |
| Commenti HN 46081704 | discussione | un agente QA separato tende a oscillare tra due soluzioni sbagliate (prova contro le review multi-agente) |
| Supporto Anthropic, articolo 15036540 | documentazione | il passaggio di `claude -p` a un pool di crediti separato è **sospeso dal 15/06/2026**: con login all'abbonamento `claude -p` usa ancora i limiti del piano (rischio da tenere d'occhio per pi-claude-code) |

## Cosa `/auto` fa già (verificato in `extensions/auto/loop.ts`, `prompts.ts`)
- Requisiti JSON con `passes`, check congelati con hash, un requisito per passo, commit per passo.
- Rilancio di tutti i check a inizio di ogni passo build (`refreshPasses`): equivale al test d'avvio di Anthropic e scopre regressioni.
- Coda dell'output del check (1500 caratteri) passata al tentativo successivo; stallo su HEAD invariato; stop su stesso errore.

## Lacune rispetto alla letteratura
1. **Nessun passaggio di consegne tra tentativi**: il figlio successivo vede solo l'output del check, non cosa ha provato il precedente. Spunto continuous-claude/Anthropic: 2–3 righe in `auto/appunti.md` scritte dal figlio, l'ultima nota (≤500 caratteri) entra nel prompt del tentativo dopo.
2. **Tentativi rossi restano nella storia**: i commit di un tentativo fallito non vengono scartati. continuous-claude scarta e riparte; per noi un'opzione: dopo N tentativi rossi sullo stesso requisito, `reset` al commit di partenza e nuovo tentativo con la nota.
3. **Nessuna rilevazione di aggiramento**: il diario `eventi.jsonl` permette regole a 0 token (tool su file congelati, `chmod`/`git checkout` sui check, tentativi bloccati dalla policy ripetuti) che alzano la salute a SERVE TE.
4. **Correzioni dell'utente non ricordate**: una nota `:` vale solo per il passo dopo. Spunto: le note marcate «sempre» vanno in `auto/regole.md`, incluso in ogni prompt (costo fisso, quindi corto e approvato dall'utente).
5. **Domanda al passo precedente** (gastown «seance»): da cockpit, chiedere al figlio di un passo chiuso «perché hai fatto X». Costa token: solo su richiesta esplicita.
