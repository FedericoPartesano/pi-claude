# Ignoto
Aggiornato: 2026-11-11 · fase 1b

| Voce | Origine | Stato |
|---|---|---|
| Canale dati supervisore → prototipo: widget testuale RPC, evento dedicato o file letto dal client | intervista | risolto (1b): file della corsa + `fs.watch`, percorso via `setStatus` |
| Persistenza degli eventi dei figli (oggi letti e scartati): formato, dimensione per passo, rotazione | intervista | risolto in parte (round 4: diario compatto `eventi.jsonl`); dimensione e rotazione aperte |
| Costo CPU della vista in diretta nel prototipo (soglia ≤ 1/4 di Pi, margine sul carico di testo ≈7% al lotto 2) | intervista | aperto |
| Come una nota dell'utente entra nel passo successivo senza rompere la cache del prompt e senza toccare i check congelati | intervista | aperto |
| Cosa vuol dire «gestire gli agenti» per l'utente (modello, skill, strumenti, team) | intervista | risolto (round 3: tutto, skill e strumenti compresi) |
| La vista serve anche nella UI classica (pi-ui, `custom()`) o solo nel prototipo | intervista | risolto (round 2: solo prototipo; nel classico riga di stato e notifiche) |
| Semantica dei comandi su un passo in corso (subito o al confine) | critico round 3 | risolto (round 4: coda unica, stop/rifai subito, resto al confine) |
| Presa in mano manuale: chi possiede il worktree, come si rileva il lavoro fatto a mano al rientro | critico round 3 | risolto nel brief: pausa = commit del supervisore, al resume confronto HEAD e ricalcolo requisiti (claude-squad `c`/`r`, `10-ricerca.md` §9) |
| Soglie esatte di A RISCHIO e N passi senza verde per PROCEDE | intervista | risolto: N = 4, soglie proposte confermate |
| Tasto `c` della pausa manuale vs tasti già usati nel prototipo (conflitti con editor e `alt+…`) | ricerca | risolto (1b): vista modale, `dialogKey` cattura i tasti; apertura con `/auto` o `alt+a` |
| Lacune del loop trovate nella ricerca larga (consegne tra tentativi, scarto dei tentativi rossi, rilevazione di aggiramento, regole permanenti): dentro questo studio o in uno studio su `/auto` | ricerca | risolto: dentro questo studio (brief, «Perimetro esteso»); N dello scarto = 2; aperto il formato di `auto/appunti.md` |
| Due sessioni Pi sulla stessa corsa: la guardia «già in corso» vale solo nel processo | territorio §4 | differita: proposta lock con pid non accettata, da discutere |
| Segreti negli argomenti e negli output salvati in `eventi.jsonl`; posizione del diario (dentro o fuori da git) | territorio §5 | differita: proposta «fuori da git + maschera» non accettata, da discutere |
| Posizione della nota nel prompt del figlio (in coda, per non spostare il prefisso) | territorio §3 | aperto (fase 3) |
| Forma della vista: k9s, lazygit, btop | territorio §7 | risolto in bozza: `30-forma-vista.md`, raccomandata B (panoramica + schede 1…5), da confermare |
