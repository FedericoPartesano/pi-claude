# Miglioramenti autonomi con le agent skills (2026-11-23)

Registro della mezz'ora di lavoro autonomo chiesta dall'utente. Intent: `intents/2026-11-23-migliora-in-autonomia-usando-le-skill.md`.

Inizio: 15:14.

## 15:16 — test rosso `eval/round2/test/workdir.test.mjs` (skill debugging-and-error-recovery)
- Sintomo: `fatal: refusing to fetch into branch 'refs/heads/main' checked out at …/repo`. Falliva anche su `origin/main`, quindi non dipendeva dalle modifiche di oggi.
- Causa: `checkoutAt` fa `git init` e poi `git fetch … <base>:refs/heads/main`. Con git 2.54 il branch iniziale è `main`, così il fetch scrive sul branch attivo (non ancora nato) e git lo rifiuta.
- Correzione: `git init -q -b unborn` in `eval/round2/workdir.mjs`; il branch temporaneo non nasce mai, il checkout di `main` lo sostituisce.
- Prova: `node --test eval/round2/test/workdir.test.mjs` → pass 1, fail 0 (prima fail 1).

## 15:16 — revisione del codice di oggi (skill code-review-and-quality)
- `recall-nudge.ts`: falsi positivi misurati offline con `needsNudge` sulle sessioni H1-bc, H1-off, R1-bc, R1-off: 448 turni normali, 0 spinte fuori dai quiz.
- `factRecall` (aggiornamenti): su H1-bc-rn, H1-off e R1-bc la riga «più recente» compare solo nei quiz, mai nei turni normali; su R1 `factRecall` non inietta nulla.
- `closeOrphaned` (`pi-claude-code/src/idle-reaper.ts`): corretto; scandisce i tool result di tutta la conversazione a ogni richiesta, ma con al massimo 3 sessioni il costo è trascurabile. Non cambiato.
- Rilievo da correggere: `needsNudge(messages, folded)` ha un parametro che l'estensione passa sempre `true` (vedi passo di semplificazione).

## 15:17 — tre miglioramenti in TDD (skill test-driven-development)
Ogni test è stato scritto prima e visto rosso (`fail 3`), poi verde (`pass 29, fail 0` su `archivio.test.ts` + `recall-nudge.test.ts`).
1. Aggiornamenti a catena (8817 → 9124 → 9300): prima tutti erano marcati «più recente»; ora solo l'ultimo, i precedenti sono «poi:».
2. Budget stretto: se il fatto vecchio più l'aggiornamento non entrano nel limite, torna solo l'aggiornamento (prima cadevano entrambi).
3. Astensioni inglesi della spinta: aggiunte «not specified/given/stated» e «never (been) mentioned/given/stated/provided».
- Difetto trovato strada facendo: in `UPDATE_CUE` i casi «ora è», «adesso è», «non è più» non scattavano mai, perché in JavaScript senza flag `u` il `\b` dopo «è»/«ù» non vale. Il quiz di H1 passava solo grazie a «cambiata». Corretto con un lookahead; verificato che «ora era» e «l'ora esatta» non scattano.
- Rimisura dei falsi positivi dopo le modifiche: invariati (0 su tutte le sessioni).

## 15:18 — latenza del recall a ogni turno (skill performance-optimization)
- Misura: con `/tmp/ar-perf.mts` sulla sessione H1-bc-rn (4.662 chunk archiviati), `search` costava 82 ms per prompt, `keyRecall` 49 ms e `factRecall` 74 ms. Girano tutte in `before_agent_start`, quindi prima di ogni risposta.
- Causa, dal profilo CPU (`node --cpu-prof`): ogni chiamata ritokenizzava tutto l'archivio, e `search` viene chiamata fino a 10 volte per prompt (una per chiave). `factRecall` calcolava l'idf con un `filter` su tutti i chunk per ogni parola.
- Correzione in `extensions/archivio.ts`:
  - token e stem in cache per testo del chunk: i chunk si ricostruiscono a ogni turno, ma i testi restano gli stessi;
  - statistiche BM25 in cache per array di chunk (`WeakMap`), condivise dalle chiamate dello stesso turno;
  - documenti compatti: un dizionario unico dei termini, e per documento id e conteggi in array tipizzati letti con ricerca binaria;
  - cache potata ai testi vivi quando supera il doppio dell'archivio.
- Risultato, con l'archivio che cresce turno per turno come nell'uso reale (`/tmp/ar-eq.mts`, confronto con `HEAD`):

  | sessione | prompt | output diversi | keyRecall+search prima | dopo |
  |---|---|---|---|---|
  | H1-bc-rn | 158 | 0 | 63,1 ms/turno | 12,4 ms/turno |
  | R1-bc | 71 | 0 | 69,4 ms/turno | 13,6 ms/turno |

  `factRecall`: da 74 a 4,5 ms per prompt, stessi 297 token iniettati su H1-bc-rn.
- Memoria delle cache su 4.662 chunk (`node --expose-gc`): 35 MB con le `Map` per documento, 11,5 MB con gli array tipizzati.
- Limiti: il dizionario dei termini non si pota (cresce col vocabolario, decine di migliaia di voci); la cache tiene una copia dei testi dei chunk (circa 4 MB su H1).

## 15:21 — semplificazione (skill code-simplification)
- `needsNudge(messages, folded)` diventa `needsNudge(messages)`: l'estensione passava sempre `true` e controlla i fold da sé dopo. Il caso «niente fold» resta coperto dal test dell'handler. Test: pass 29, fail 0. Falsi positivi rimisurati: invariati.

## 15:22 — controlli di contorno
- Dizionario dei termini, che non si pota: su sessioni intere arriva a 8.251 termini (H1, 3,8 MB di testo) e 18.091 (R1, 2,7 MB). Circa 1–2 MB: limitato, non cambiato.
- Dump di `decompress` in `~/.cache/pi/acp-decompress/`: il pacchetto non li cancella mai. Oggi sono 5 file per 568 KB. È codice di terzi a versione fissata, quindi niente modifiche: consiglio a monte (vedi in fondo).
- Difetto trovato in `factRecall` (TDD, test prima rosso `actual: ['u2', 'u1']`): `onUsed` segnalava come usati gli aggiornamenti prima del controllo sul limite, e il fatto vecchio anche quando era tagliato. Il log `archive-recall` dichiarava quindi voci non inviate. Ora si segnala solo ciò che entra davvero nel testo. Test pass 29; iniezione su H1-bc-rn invariata (297 token), su R1-bc ancora 0.

## 15:25 — verifica empirica dentro Pi (replay di 2 turni, haiku)
- Replay dei due quiz H1 sulla sessione H1-bc-rn troncata prima del quiz, con il codice di oggi (`/tmp/rn-replay3`): porta 9124 e scadenza 7 gennaio corrette; la riga «più recente» viene iniettata in entrambi i quiz.
- Punteggio dello scorer 17/19 (9/10 e 8/9), uguale al replay precedente. Mancano «nome in codice» (sbagliato) e «giorni reso» (non detto). Costo 362k pesati contro 278k del replay precedente: il modello ha usato `codemode` e un `compress`. È variabilità del modello, non del recall.
- Errore mio corretto: nel REPORT §7 e nell'intent di billion-context avevo scritto 18/19 per il primo replay, contato a mano. Lo scorer dà 17/19 (16/19 senza il valore trovato con `bash`). Testi corretti.

## 15:27 — suite completa e chiusura
- Suite completa (`node --test --test-concurrency=4`, 1.149 test): 1.139 passati, 9 saltati, 1 fallito. Bridge: 40 su 40.
- Il test fallito è `pi-memory/test/memory-worker.test.ts` «warming a 30k-memory store happens off the UI thread»: «UI thread blocked 32 ms» contro una soglia di 30 ms. Non è toccato da questo lavoro e, rieseguito da solo, passa 3 volte su 3 (8 su 8 nel file). È instabile sotto il carico di 4 processi paralleli. La soglia non è cambiata perché le soglie non si toccano senza chiedere.
- Durata: dalle 15:14 alle 15:27, circa 13 minuti invece dei 30 previsti. Il lavoro pianificato è finito prima; il resto (sotto) richiede decisioni o run costose.
- Nessun commit: le modifiche restano nel working tree in attesa della richiesta esplicita dell'utente (regola di CLAUDE.md).

## Consigli per i passi successivi
1. Commit per tema, solo su richiesta: `fix(eval)` per workdir; `fix(archivio)` per gli aggiornamenti a catena, il budget, `UPDATE_CUE` e `onUsed`; `perf(archivio)` per le cache del recall (da 63 a 12 ms per turno); `fix(recall-nudge)` per le astensioni inglesi e la semplificazione.
2. Test di `memory-worker` instabile sotto carico: alzare la soglia (per esempio a 50 ms) o eseguirlo in serie. Serve una decisione dell'utente.
3. Uso di `bash` sui dump di `decompress` nei quiz: si può vietare con una guardia sui percorsi `~/.cache/pi/acp-decompress/`, ma cambia il comportamento visibile del modello. Da decidere.
4. Dump di `decompress` mai cancellati da `billion-context-pi`: segnalarlo a monte, oppure pulire i file più vecchi di N giorni da `install.sh`.
5. (Risolto il 2026-11-23, vedi REPORT §7: «giorni reso» con `constSearch`; «nome in codice» era un errore dello scorer nei replay.) «Giorni reso» e «nome in codice» mancano in entrambi i replay. È il prossimo difetto di recall da studiare offline: vedere se il fatto è nell'archivio e perché `factRecall` non lo prende.
6. Una run H1 completa con il codice di oggi confermerebbe il guadagno (circa 4–6M token pesati): solo con l'ok dell'utente.
