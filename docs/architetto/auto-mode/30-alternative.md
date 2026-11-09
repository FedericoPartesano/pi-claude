# Alternative
Aggiornato: 2026-11-09 · fase 4

## Raccomandazione
**B — supervisore leggero nella sessione + un processo figlio `pi -p` per passo, con cwd = worktree.** Non contraddice l'idea iniziale (agente singolo a fasi sopra `goal.ts`), ma i passi escono dal Pi dell'utente. A è esclusa da una misura: dopo `process.chdir` + `newSession` i tool lavorano ancora nel repo principale (M3). C è l'evoluzione di B quando servirà girare senza Pi (CI, Proxmox). I due critici, indipendenti, convergono: B > C > A, fiducia 60% ciascuno.

## Candidate
Parti comuni a tutte (decise in fase 1–1b, non discriminano): stato in `auto/` nel worktree (`stato.json` fase/passo/budget, `requisiti.json` con `passes`, `decisioni.md`, `da-approvare.md`), branch `auto/<slug>`, check congelati rieseguiti dal codice, completamento letto dallo stato su disco e mai dall'output del modello, lista nera in `tool_call`, comandi bash riscritti in `unshare -rn sh -c '…'` da build in poi, timeout per passo, motivi di arresto tipizzati (da ralph-orchestrator), soglie di stallo (da frankbria).

### A — Orchestratore nella sessione dell'utente (candidata dichiarata nel brief)
- Invarianti che fissa: un solo processo Pi; ogni passo è `ctx.newSession()` lanciato da un comando `/auto-next` richiamato con `pi.sendUserMessage` in `agent_settled`; le estensioni del ciclo (guardie, congelamento) girano nello stesso runtime dell'utente.
- Seme minimo: `extensions/auto.ts` (comandi `/auto`, `/auto-next`, `/auto resume`), riuso di `goal.ts` per i limiti, di `guards.ts` per la lista nera.
- Dove vive lo stato: file in `auto/` nel worktree; il runtime viene smontato a ogni passo (`session_shutdown`), quindi nulla in memoria.
- Come evolve: fasi e skill da `phases.json`; un passo in più è una voce del piano.
- Da quali repo prende: claude-quickstarts (fase dallo stato su disco), snarktank (`prd.json`).
- Punto aperto: il bridge usa `process.cwd()` e Pi `ctx.cwd`; lavorare nel worktree richiede `process.chdir` nel processo dell'utente o che `newSession` cambi cwd (documentato solo per `/resume`, `extensions.md` riga 431).

### B — Supervisore leggero nella sessione + un processo figlio per passo
- Invarianti che fissa: il Pi dell'utente ospita solo il supervisore (codice, zero prompt); ogni passo è un processo `pi --mode json -p --no-session --no-extensions -e auto-worker.ts --tools read,bash,edit,write,… ` con `cwd` = worktree; l'estensione `auto-worker.ts` (guardie, congelamento, iniezione dello `SKILL.md` di fase) esiste solo nei figli.
- Seme minimo: `extensions/auto.ts` (supervisore: worktree, ciclo, check, arresto, barra/pannello) + `extensions/auto-worker.ts`; avvio dei figli copiato da `pi-team/src/runner.ts:41–51`.
- Dove vive lo stato: file in `auto/` nel worktree e git; il supervisore tiene in memoria solo il processo figlio corrente.
- Come evolve: più figli in parallelo (evoluzione `pi-team`) senza cambiare il formato dello stato; modello per fase passato con `--model`.
- Da quali repo prende: snarktank (processo nuovo per giro), ralph-orchestrator (motivi d'arresto, worktree), frankbria (soglie, `rate_limit_event`).
- Punto aperto: chiudere Pi o `/custom-reload` uccide il supervisore (il figlio resta orfano o muore); si riprende con `/auto resume`.

### C — Runner staccato fuori da Pi
- Invarianti che fissa: `bin/pi-auto.mjs` è un processo autonomo (avviato con `setsid nohup` da `/auto` o dal terminale) che esegue lo stesso ciclo di figli di B; il Pi dell'utente legge solo `auto/stato.json` per barra e pannello.
- Seme minimo: `bin/pi-auto.mjs` + `extensions/auto-worker.ts` + una piccola estensione di sola vista.
- Dove vive lo stato: come B; in più un file di lock/PID per il runner.
- Come evolve: eseguibile anche senza UI (CI, Proxmox); più runner su più worktree.
- Da quali repo prende: frankbria (ciclo esterno con file di stato), ralph-orchestrator (file sentinella `stop-requested`).
- Punto aperto: avvio staccato su Windows nativo e macOS; nessun canale diretto con l'utente oltre ai file e alle notifiche.

## Esito di tradeoff
Scenari dal brief. Prove lette o eseguite in questa corsa:
- `extensions.md` 1348–1380: `newSession` non ha cwd. Righe 1586 e 1892: `setActiveTools`.
- `pi --help`: con `--no-extensions` «explicit -e paths still work»; `--tools` è una lista bianca.
- `pi-claude-code/src/provider.ts:95,310`: `process.cwd()`.
- `pi-team/src/runner.ts:41–51`.
- `10-ricerca.md` R2–R3.
- Misure M1–M5 qui sotto, con haiku sul provider `claude-code`, il 2026-11-09. Dati in `eval/auto/REPORT.md`.

### Misure
- **M1, prefisso per turno.** Turno «rispondi solo: ok».
  - Sessione completa dell'utente: 23 906 token, 6,8–8,6 s.
  - Figlio `--no-extensions -e pi-claude-code --no-skills --tools read,bash,edit,write`: 4 554 token, 4,4–6,6 s.
  - Dal secondo giro entrambi i prefissi vanno in cache (cacheRead), quindi sono stabili. Il figlio costa il 19% per turno, e ogni turno di un passo rilegge il prefisso.
- **M2.** Il figlio con un'estensione che registra un comando e due hook: 4 554 token, invariato. Comandi e hook costano 0 token a riposo.
- **M3, cwd in A.** Comando `/s2` che esegue `process.chdir(worktree)` e poi `ctx.newSession()`.
  - Nella nuova sessione `ctx.cwd` resta il repo principale.
  - Il tool `bash` esegue `pwd` e ottiene `/home/fede/documents/projects/pi-claude`.
  - Solo `process.cwd()` è il worktree.
  - Estensione di prova in `/tmp/s2/ext.ts`, log in `/tmp/s2/log.txt`.
- **M4, loopback con `unshare -rn`.** Un server `http` su 127.0.0.1 parte anche senza `ip link set lo up`. L'obiezione del critico 2 cade.
- **M5, `bwrap` per comando** (`--ro-bind / / --bind <worktree> --bind <repo>/.git --unshare-net`):
  - in 0,04 s scrive nel worktree, fa `git commit` sul branch e blocca la rete;
  - rifiuta le scritture fuori dal worktree (`Read-only file system`);
  - `git branch -f master` sul repo principale è rifiutato da git perché `master` è in uso nel worktree principale;
  - restano scrivibili gli altri ref in `.git` (da coprire con la lista nera: `update-ref`, `branch -f`, `push`).

### Verdetti
| Candidata | Completamento (5, portante) | Sicurezza (5, portante) | Costo (4, portante) | Giri a vuoto (4) | Ripresa (3) | Decisioni leggibili (3) | Leggerezza (2) |
|---|---|---|---|---|---|---|---|
| A | unknown(banco) | **fail(M3: i tool lavorano nel repo principale, fuori dal branch `auto/…`)** | fail parziale(M1: prefisso 23 906 token per turno, 5,2× B) | pass | unknown(crash del Pi dell'utente) | pass | fail(sessione dell'utente occupata e spostata per ore) |
| B | unknown(banco, comune) | pass (cwd del figlio = worktree, `runner.ts`; `--tools` lista bianca; `tool_call` + rete spenta, R2/M4; fs in sola lettura fuori dal worktree possibile con `bwrap`, M5, solo Linux/WSL) | pass sul misurabile (riposo 0 token, M2; 4 554 token per turno, M1); ≤30% a goal: banco | pass (timeout del figlio come `AGENT_TIMEOUT_MS`) | unknown(`/custom-reload` uccide il supervisore; figlio orfano) | pass | pass (worktree 0,92 s, R3; nessun timer) |
| C | unknown(banco, comune) | pass (come B) | pass (come B) | pass (+ sentinella di stop) | pass parziale (sopravvive a Pi); unknown(lock orfano, avvio staccato su Windows e macOS) | pass | unknown(vista da `stato.json`: polling o `fs.watch`) |

Il Completamento è `unknown` per tutte. Non distingue tra le candidate (stesso ciclo e stesso stato) e si misura sul banco a costruzione fatta (ignoto 2). Per questo filtro B e C sopravvivono sul resto dei portanti.

### Sopravvissuti ed esclusi
- **A esclusa**: fail(M3) su Sicurezza, che è portante. La riammetterebbe solo un cambio di sessione che sposta davvero `ctx.cwd` nel worktree (per esempio passare a un file di sessione creato con il cwd del worktree, come fa `/resume`). Non provato.
- **Sopravvissute B e C.**

### Critica incrociata
Testi integrali in `30-critico-1.md` e `30-critico-2.md`: 2 processi `pi -p` indipendenti, haiku, sola lettura, nessuno dei due vede la raccomandazione.

**Convergenze**
- Entrambi danno B > C > A, fiducia 60%.
- Entrambi usano M3 per escludere A.
- Entrambi segnalano che `goal.ts` rilegge i check dall'intent a ogni `goal_done`, e che con zero outcome basta una prova da 12 caratteri: «completamento letto dallo stato» oggi è dichiarato ma non implementato.
- Entrambi ricordano che `runner.ts` non passa `--no-extensions`: copiato così com'è, riporterebbe il prefisso a 23 906 token.

**Obiezione più forte contro B** (critico 1): `unshare -rn` chiude la rete ma non il filesystem. Un `rm` o un `git -C` su un percorso assoluto supera una lista nera testuale.
- Regge in parte: M5 mostra che `bwrap` chiude il filesystem in 0,04 s per comando, ma solo su Linux e WSL.
- macOS (`sandbox-exec`) e Windows nativo restano scoperti (ignoto 12).
- In fase 1b il «sandbox» era stato scartato, ma come esecuzione dentro un container. Il `bwrap` per singolo comando è un'altra cosa e va deciso.

**Obiezione contro C**: viola la piattaforma Windows (`setsid nohup`), aggiunge polling al pannello e lascia lock orfani.

**Obiezione caduta**: il loopback spento con `unshare -rn` (M4).

### Trade-off ceduti
- Nei passi non ci sono le estensioni dell'utente (memoria, vault, archivio): il figlio sa solo quello che sta in `auto/` e nel repo.
- Ogni passo paga un avvio a freddo, misurato in 4,4–6,6 s.
- Il ciclo muore con Pi o con `/custom-reload`. In cambio c'è un solo processo da gestire, con `/auto resume`.
- La logica di completamento di `goal.ts` non si riusa così com'è nel figlio. Va nel supervisore, riscritta.

### Falsificatore
- S1 non è scattato: 4 554 token contro 23 906, cioè il 19%, ben sotto la soglia dell'80%.
- Dopo la costruzione, la scelta è sbagliata se nelle prime 5 esecuzioni succede uno di questi casi:
  - un passo medio supera il 6% della finestra 5h;
  - un `/auto resume` dopo un `/custom-reload` ripete un commit o lascia un figlio orfano che modifica il worktree.

### Difesa
- B lavora nel worktree. Il figlio prende il cwd dal processo (`runner.ts` `spawn(…, { cwd })`, `provider.ts:310`), mentre A no (M3).
- B costa il 19% di A per turno (M1), e 0 token a riposo (M2).
- La superficie dei tool è minima: `--tools` e `--no-extensions` (`pi --help`).
- C condivide i pregi di B, ma aggiunge rischi non misurati su Windows, sui lock e sul polling (verdetti, critici).

### Rischi e unknown residui
- **Completamento.** Il supervisore deve fotografare i check (con hash) a fine plan, rieseguirli lui e calcolare `passes` dagli esiti. Non deve fidarsi del file scritto dal modello.
- **Orfani.** Va ucciso il gruppo di processi del figlio quando il supervisore muore; `/auto resume` deve essere idempotente rispetto all'ultimo commit.
- **Filesystem.** `bwrap` su Linux e WSL; macOS e Windows nativo da decidere.
- **Banco** (ignoto 2).
