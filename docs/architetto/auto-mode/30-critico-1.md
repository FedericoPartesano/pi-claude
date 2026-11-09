**Critica indipendente: auto mode di Pi**

**Verifiche:** ho letto `runner.ts`, `goal.ts`, `provider.ts` e i profili. Ho controllato anche `extensions.md` e `pi-claude-code`.

**A: orchestratore nella sessione dell'utente**
- **Costo (portante): a rischio.** M1 misura 23 906 token di prefisso contro 4 554 in un figlio snello. Ogni passo ricade su quel prefisso, cioè circa 5 volte il costo per turno. Il ciclo «≤30% della finestra» non è misurato da nessuna parte.
- **Sicurezza (portante): difetto grave.** M3 dice che dopo `process.chdir` il bash resta sul repo principale, mentre il bridge usa il worktree (`provider.ts:310`). Il modello scrive fuori dal branch: è il fallimento che il candidato stesso elenca.
- **Punti di forza:** riusa `goal.ts`, con check eseguiti dal codice e prova minima. È il codice più piccolo.
- **Fallimento più probabile:** il passo 2 committa sul repo principale, e l'utente deve disfare a mano.

**B: supervisore + un figlio per passo**
- **Costo:** il figlio snello (4 554) è la scelta giusta. Ma `runner.ts:41–51` non passa `--no-extensions` né `-e`: copiarlo così com'è riporta il costo a 23 906. Il candidato va corretto.
- **Sicurezza (portante): lacuna.** `unshare -rn` chiude la rete, non il filesystem. `bwrap` è installato e non è usato. Un `git -C ~/repo reset --hard` o un `rm` su percorso assoluto passa la lista nera. Su macOS e Windows non c'è isolamento: il vincolo di piattaforma e la sicurezza sono in conflitto.
- **Completamento (portante): rischio concreto.** `goal.ts` `completionVerdict`: con zero outcome nell'intent basta una prova da 12 caratteri, e i `checks` del `## Verifica` sono letti dal file al momento della chiusura. Il file è scrivibile dal modello. Il candidato dice «check congelati»: va congelato all'avvio, non riletto.
- **Punti di forza:** isolamento dei processi, cwd corretto, timeout a 20 minuti e tetto di token già in `runner.ts`.
- **Fallimento più probabile:** `/custom-reload` uccide il supervisore, il figlio resta orfano e continua a modificare il worktree.

**C: runner staccato**
- Eredita i rischi di B su sicurezza, costo e check.
- **Leggerezza:** il pannello legge `stato.json`, quindi serve polling o `fs.watch`, in contrasto con «nessun timer».
- **Ripresa:** file di lock e PID si lasciano dietro dopo un crash. Due runner sullo stesso worktree sono possibili.
- **Piattaforme:** `setsid nohup` non è portabile, e il candidato lo ammette.
- **Punti di forza:** gira senza Pi, in CI o su Proxmox, e dà un arresto esplicito tramite sentinella.
- **Fallimento più probabile:** lock orfano dopo un crash, poi un secondo runner che consuma quota senza interfaccia.

**Trasversali**
- Il candidato promette «completamento letto dallo stato su disco». Ma `passes` in `requisiti.json` è scrivibile dal modello: va ricalcolato dal supervisore.
- Nessuna delle tre misura il costo medio di un goal, né conta i comandi vietati eseguiti.

**Classifica:** B > C > A.
Fiducia: **60%**. B è la scelta più solida, ma i tre portanti non hanno ancora una prova: il tetto di costo per goal non è misurato, e la sicurezza sul filesystem poggia su una lista nera più `unshare`.
