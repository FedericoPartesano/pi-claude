---
status: accepted
---
# Auto mode: un processo figlio `pi -p` per passo, nel worktree

Auto mode porta un goal a termine da solo, su un branch `auto/<slug>` in un git worktree. Ogni passo del piano gira in un processo figlio `pi --mode json -p --no-session --no-extensions -e pi-claude-code -e auto-worker.ts --tools …`, con cwd uguale al worktree. Il Pi dell'utente ospita solo un supervisore fatto di codice, senza prompt. Il motivo: è l'unico modo, tra quelli provati, in cui i tool lavorano davvero nel worktree, e il prefisso per turno scende al 19%.

## Osservazione → spiegazione → scelta e conseguenza
- **Osservazione.**
  - `ctx.newSession()` non accetta un cwd.
  - Dopo `process.chdir(worktree)` più `newSession`, il tool `bash` lavora ancora nel repo principale (M3).
  - Il prefisso per turno della sessione completa dell'utente è di 23 906 token; quello di un figlio snello è di 4 554 (M1).
  - Un comando e degli hook di estensione costano 0 token (M2).
- **Spiegazione.** Il cwd dei tool lo fissa la sessione all'avvio, non il processo. Il prompt dell'utente (estensioni, skill, CLAUDE.md) viene riletto a ogni turno di ogni passo.
- **Scelta e conseguenze.**
  - Il completamento lo decide il supervisore. I check vengono congelati con hash a fine plan e rieseguiti da lui; `passes` lo calcola lui dagli esiti, mai dal testo del modello.
  - La logica di completamento di `goal.ts` non si riusa così com'è, perché rilegge i check dall'intent e accetta prove di 12 caratteri.
  - I comandi bash del figlio vengono riscritti dentro `bwrap`, dove disponibile: filesystem in sola lettura fuori dal worktree e dal `.git` del repo, rete spenta da build in poi, 0,04 s a comando (M5).
  - Dove `bwrap` manca si usa `unshare -rn` più la lista nera in `tool_call`. Su macOS e Windows nativo il filesystem è protetto solo dalla lista nera.
  - Ogni figlio ha un timeout (come `AGENT_TIMEOUT_MS` in `pi-team/src/runner.ts`). Al contrario di `runner.ts`, il figlio parte con `--no-extensions`.
  - Nei passi mancano memoria, vault e archivio dell'utente: il figlio sa solo ciò che sta in `auto/` e nel repo.
  - Ogni passo paga un avvio a freddo di 4,4–6,6 s.
  - Il ciclo muore con Pi o con `/custom-reload`. Il supervisore uccide il gruppo di processi del figlio, e `/auto resume` riparte dall'ultimo commit in modo idempotente.

## Obiezione più forte e falsificatore
- **Obiezione.** Una lista nera testuale non ferma un `rm` o un `git -C` su un percorso assoluto. Regge solo dove c'è `bwrap` (Linux e WSL). Gli altri ref in `.git` restano scrivibili anche lì, e li coprono i divieti nel codice (`update-ref`, `branch -f`, `push`).
- **Falsificatore.** La scelta è sbagliata se, nelle prime 5 esecuzioni reali, succede uno di questi casi:
  - un passo medio supera il 6% della finestra 5h;
  - un `/auto resume` dopo un `/custom-reload` ripete un commit o lascia un figlio orfano che modifica il worktree.

## Alternative scartate
- **A — orchestratore nella sessione dell'utente** (`newSession` per passo): esclusa da M3, perché i tool lavorano fuori dal branch. In più pesa il prefisso di 23 906 token per turno, e la sessione dell'utente resterebbe occupata per ore.
- **C — runner staccato fuori da Pi**: rimandata. Ha gli stessi pregi di B, ma `setsid nohup` non esiste su Windows nativo, il pannello avrebbe bisogno di polling e restano lock orfani. È l'evoluzione naturale quando servirà girare senza Pi (CI, Proxmox).
- Due critici indipendenti: B > C > A, fiducia 60% ciascuno.

## Cosa non sappiamo ancora
- Il tasso di completamento sul banco `eval/auto/` (≥ 7/10).
- Il costo di un goal intero.
- L'isolamento su macOS (`sandbox-exec`) e su Windows nativo.
- Se il prompt di fase basta senza la memoria dell'utente.

Riferimenti: `docs/architetto/auto-mode/{10-ricerca,20-confronto,30-alternative}.md`; misure in `eval/auto/REPORT.md`.
