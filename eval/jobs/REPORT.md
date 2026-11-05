# Sleep con e senza `lancia` (extensions/jobs.ts)

Banco: `node eval/jobs/run.mjs <A|L> <rep>` (haiku, provider claude-code, Pi RPC). Stesso prompt e stesso script in tutti i run: `slow.sh` dura 100 s (5 passi da 20 s) e stampa un codice casuale; il prompt dice che nel progetto vero dura oltre 5 minuti, quindi di non aspettarlo in primo piano (scenario sintetico: il job reale è più breve). Braccio A = Pi com'è (solo bash); braccio L = `PI_JOBS=1` (tool `lancia` acceso dall'inizio). Costo pesato 0,1/1,25/5 come `eval/ab`. Correttezza: la risposta finale contiene il codice.

| Run | Chiamate con `sleep` | Chiamate bash | Richieste | Costo pesato | Durata | Codice giusto |
|---|---|---|---|---|---|---|
| A1 | 1 (`sleep 2` nel lancio) | 2 | 3 | 16.502 | 20 s | no |
| A2 | 1 (`sleep 105; cat log`) | 3 | 4 | 18.452 | 124 s | sì |
| A3 | 1 (`sleep 2` nel lancio) | 2 | 3 | 16.575 | 20 s | no |
| L1 | 0 | 1 | 4 | 24.147 | 115 s | sì |
| L2 | 0 | 1 | 4 | 18.044 | 119 s | sì |
| L3 | 0 | 1 | 4 | 18.090 | 118 s | sì |

- **Sleep: 0 su 3 con `lancia`, 3 su 3 senza** (conteggio delle chiamate bash che contengono `sleep`; in A1 e A3 è un `sleep 2` nel lancio, solo A2 aspetta davvero 105 s).
- **`lancia` ha risvegliato il modello in 3 run su 3**: il messaggio di fine job ha avviato un secondo turno (2 `agent_settled`) con il codice nel log.
- **A1 e A3 sbagliano:** il modello lancia `nohup ... &`, chiude il turno scrivendo che avviserà quando finisce, ma senza `lancia` nessun evento lo risveglia: la promessa non si può mantenere. Non è un sleep evitato, è una risposta mancata. Solo A2 aspetta con un sleep e risponde giusto.
- **Costo:** L2 e L3 (18.044, 18.090) ≈ A2 (18.452, −2%); L1 (24.147) è un valore alto non spiegato (non indagato). A1 e A3 costano meno perché non rispondono.
- **Il modello ha scelto `lancia` da solo** (descrizione del tool), senza regole nel prompt, in 3 run su 3.

Limiti: n=3 per braccio, un solo modello (haiku), un solo carico, job da 100 s; non misurato il costo fisso della descrizione del tool nelle sessioni senza job lunghi (tool spento di default); non provato `/resume`, né più job insieme. Il tool è acceso dall'inizio (`PI_JOBS=1`): accenderlo a metà sessione con `/jobs on` riscrive la cache una volta, non misurato qui.
