**Critica indipendente: auto mode di Pi (A, B, C)**

**Trasversali (tutte e tre)**
- **Check e completamento non sono congelati.** `extensions/goal.ts` (`goal_done`) rilegge l'intent a ogni chiamata (`readIntent`) e somma `intent?.checks`. Il modello può cancellare un check nel file e il controllo passa. In `completionVerdict`, con `outcomes` vuoti, basta una sola prova con 12+ caratteri. Il criterio «completamento letto dallo stato su disco» è dichiarato, non implementato, e lo stato lo scrive il modello.
- **`unshare -rn` non è misurato sui casi che contano.** R2 prova solo `git status`, `curl` e `https.get`. Una netns nuova ha il loopback spento: i test che aprono server su 127.0.0.1 dentro bash probabilmente cadono. Da misurare.
- **Costo: nessuna misura di un goal intero.** `10-ricerca.md` lo dichiara ignoto. Il criterio «≤ 30% della finestra 5h» non è verificabile oggi.

**A — orchestratore nella sessione**
- Attacco: M3 mostra che dopo `process.chdir` il tool bash e `ctx.cwd` restano nel repo principale. Il lavoro finisce sul working tree principale, fuori dal branch `auto/…`. È il modo di fallimento elencato nel brief, già misurato, e non un dettaglio aperto.
- Costo: M1 dà 23 906 token di prefisso contro 4 554 di un figlio. Su un criterio portante A paga circa cinque volte per turno.
- Punto forte: un solo processo, riuso di `goal.ts` (pausa a 20 giri, `readBudgetStop` al 90%, footer), codice minimo.
- Fallimento più probabile: prima esecuzione reale con modifiche nel repo principale e intent letto dal cwd sbagliato.

**B — supervisore + figlio per passo**
- Punto forte: il figlio ha cwd del worktree (il bridge usa `process.cwd()`, `provider.ts`). `pi-team/src/runner.ts` ha già argomenti, timeout di 20 min e budget di token per ruolo: codice provato da riusare.
- Attacco: il figlio non carica `goal.ts`, quindi la logica di completamento va riscritta. `-e auto-worker.ts` deve usare il percorso reale (CLAUDE.md: Pi non segue i symlink). Ogni passo è un avvio a freddo, e il costo non è misurato.
- Fallimento più probabile: `/custom-reload` o chiusura di Pi uccide il supervisore a metà passo, e `/auto resume` ripete un commit.

**C — runner staccato**
- Attacco: viola il vincolo «Piattaforme: Windows». `setsid nohup` non ha equivalente nativo (R2 non ne trova). Il pannello che legge `stato.json` introduce polling, contro lo scenario «nessun timer».
- Punto forte: sopravvive alla chiusura di Pi, è eseguibile in CI, risolve il punto aperto di B.
- Fallimento più probabile: su Windows nativo il runner non parte, o il pannello si aggiorna in ritardo senza che nessuno se ne accorga.

**Classifica: B > C > A**
Fiducia: **60%**. B ha la prova più solida su cwd e token e riusa codice già in uso. C eredita la stessa architettura con più vincoli. A ha un difetto misurato sulla sicurezza del worktree, ma se M3 si rivelasse errata sarebbe seconda. Il rischio più grande per tutte e tre resta il completamento scritto dal modello.
