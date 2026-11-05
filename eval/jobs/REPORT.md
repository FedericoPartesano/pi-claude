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

## Ripetizione: durate 40, 100 e 200 s, 3 run per cella (18 run)
Comando: `node eval/jobs/run.mjs <A|L> <rep> haiku <secondi>`; stesso prompt, haiku. I due bracci giravano in parallelo (due flussi, cartelle diverse). «Chiamate con sleep» conta le chiamate bash che contengono `sleep`, compresi i `sleep 2` del comando di lancio.

| Durata job | Braccio | Codice giusto | Chiamate con sleep (somma) | Costo pesato medio |
|---|---|---|---|---|
| 40 s | A (bash) | 2/3 | 3 | 19.345 |
| 40 s | L (`lancia`) | 3/3 | 0 | 18.462 |
| 100 s | A | 3/3 | 4 | 18.842 |
| 100 s | L | 3/3 | 0 | 16.300 |
| 200 s | A | 1/3 | 2 | 16.969 |
| 200 s | L | 3/3 | 0 | 17.085 |

Totali (con i 3 run da 100 s già riportati sopra: stesso banco, ma run diverse): **L 9/9 corrette, 0 sleep; A 6/9 corrette, 9 chiamate con sleep.**
- **Sleep:** 0 su 9 con `lancia`; 9 su 9 run di A ne contengono almeno uno, salvo A3 da 200 s (nessuno). L'attesa vera (`sleep 105`, `sleep 230` ecc.) è in 4 run su 9.
- **Qualità:** A sbaglia 3 run su 9 (A3 da 40 s, A2 e A3 da 200 s): il modello lancia `nohup … &`, scrive che avviserà a fine job e chiude il turno in 8–10 s, senza il codice. Con `lancia` il messaggio di fine job lo risveglia sempre (9 su 9, 2 `agent_settled` per run).
- **Costo:** differenza tra i bracci tra −13% (100 s) e +0,7% (200 s), ma i run di A che non rispondono costano meno perché si fermano subito: non è un confronto a parità di lavoro. Su 40 s L medio −4,6%, su 200 s pari. Il run L1 da 40 s (22.634) e A1 da 40 s (22.949) sono alti in entrambi i bracci (prima richiesta con cache fredda, non indagato).
- **Durata:** i run di L durano quanto il job (+7–10 s), nessuna attesa in più.
- Il modello ha scelto `lancia` in 9 run su 9 senza regole nel prompt.

Limiti: n=3 per cella, solo haiku, job sintetico che stampa un codice, prompt che chiede di non aspettare in primo piano (carico favorevole al tool). Non misurati: costo fisso della descrizione del tool nelle sessioni senza job lunghi, più job insieme, `/resume`, sessione lunga con compattazione durante l'attesa.
