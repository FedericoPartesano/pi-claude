# Compressione del contesto con billion-context-pi: misure

Data: 2026-11-23. Pacchetto `billion-context-pi@0.1.83` (motore `acp-kernel`), Pi 1.5.2 locale, bridge `pi-claude-code`, modello haiku. Intent: `intents/2026-11-23-compressione-contesto-billion-context.md`.

## Configurazioni

- **off**: senza billion-context. Il compact di Pi resta attivo.
- **full**: billion-context col prompt di sistema completo, cioè tutte le `promptSections`.
- **lean**: profilo `scripts/acp-profile.json`. Toglie la sezione TOOLS (doppione delle descrizioni dei tool) e le sezioni tier 2 e tier 3. Le regole di quei due livelli, copiate alla lettera, passano nei nudge `t2Guidance` e `t3Guidance`, quindi arrivano solo quando il kernel chiede quel livello.
- **lean-b**: come lean, ma con la sezione TOOLS (`promptSections: {tier2:null, tier3:null}`).
- **v2** (profilo attuale): lean più HOW TO COMPRESS accorciato (da 5,9k a ~1k caratteri, chiede di tenere alla lettera nomi, valori, righe trovate), THROTTLE RETRY e CONTEXT BREAKDOWN tolte, DECOMPRESS riscritta in RECALL ("prima search_context, poi decompress, mai «non so» senza cercare"), `modelContextLimit: 100000` (finestra di lavoro: i nudge partono a 45–75k invece che a 90–150k) e `preserveRecentTools: ["read"]`. In più, in tutte le configurazioni, l'archivio (`extensions/archivio.ts`) indicizza i blocchi compressi e richiama da solo la riga di definizione degli identificatori nominati nel prompt.

## 1. Costo fisso per richiesta

Prompt "rispondi solo: ok". Si conta la seconda chiamata, a cache calda, con input = cacheRead. Il system prompt l'ha catturato il finto `claude` (`claude-prompt-shim`).

| Config | System prompt (byte) | Token per richiesta | Delta su off |
|---|---|---|---|
| off | 63.292 | 26.584 | — |
| lean | 76.014 | 33.133 | +6.549 (+25%) |
| lean-b | 77.508 | 33.655 | +7.071 (+27%) |
| full | 83.206 | 35.764 | +9.180 (+35%) |
| v2 | 69.906 | 31.103 | +4.519 (+17%) |

Il profilo lean risparmia 2,6k token su ogni richiesta rispetto al prompt completo; v2 ne risparmia altri 2k (−4,7k sul completo). Resta un costo fisso di +4,5k token per richiesta.

## 2. Sessione lunga a turni (`turns.sh`)

Una invocazione di `pi -p` per ciascuno di 14 file grandi, tutte sulla stessa sessione (`--continue`): ogni turno legge il file per intero e risponde con una riga. All'ultimo turno il modello deve richiamare 7 costanti viste nei file, senza rileggerli. I tool di contesto sono ammessi.

| Run | Richieste | Token in totali | Cache hit | Compact di Pi | Spawn / resume del bridge | compress | Recall corretti |
|---|---|---|---|---|---|---|---|
| t-off | 32 | 2,712M | 0,594 | 2 eseguiti | 20 / 15 | — | 0/7 |
| t-off2 | 32 | 2,715M | 0,603 | 2 eseguiti | 20 / 15 | — | 0/7 |
| t-lean | 35 | 2,792M | 0,664 | 4, tutti annullati | 17 / 16 | 2 | 0/7 |
| t-leanb | 34 | 2,809M | 0,652 | 5, tutti annullati | 17 / 16 | 2 | 0/7 |
| t-full | 38 | 3,075M | 0,692 | 6, tutti annullati | 17 / — | 2 | **6/7** (1 search_context) |
| t-full2 | 36 | 3,181M | 0,622 | 9, tutti annullati | 18 / — | 3 | 0/7 |

Risultati:

- **Token**: con billion-context i token in totali crescono, non calano. Rispetto a off si va da +3% (lean) a +13/17% (full). Su questo carico il costo fisso del prompt pesa più di quanto la compressione faccia risparmiare.
- **Cache**: il tasso di hit è più alto (0,65–0,69 contro 0,59–0,60) e i processi `claude` avviati dal bridge sono 17–18 invece di 20. Il compact di Pi azzera la cache; i fold di billion-context la azzerano meno spesso.
- **Qualità**: i riassunti scritti dal modello con `compress` perdono i valori esatti delle costanti, come quelli del compact di Pi. Il richiamo è riuscito una sola volta su 4 run con billion-context (t-full), ed è riuscito perché il modello ha usato `search_context`. Nelle altre 3 il modello ha risposto "non so" senza aprire i blocchi: in nessuna run a turni ha chiamato `decompress`. Il ripristino quindi è possibile, ma il modello lo usa poco.
- **Varianza**: alta. Le due run full danno 6/7 e 0/7. Con 2 run per configurazione non si può dire che lean e full differiscano in qualità.

## 3. Prompt singolo (`run.sh`, primo tentativo)

Un solo prompt che legge 14 file e poi fa il recall di 5 valori. Carico troppo rumoroso: il numero di richieste varia da 15 a 40 tra run uguali. Lo si riporta per completezza.

| Run | Richieste | Token in totali | Hit | Esito |
|---|---|---|---|---|
| off | 31 | 2,445M | 0,816 | non finisce: chiede conferma |
| lean | 40 | 3,047M | 0,888 | 14/14 file, 5/5 |
| off2 | 19 | 1,465M | 0,831 | 5/5, da letture parziali |
| lean2 | 17 | 1,091M | 0,841 | 1/5: riassunto b1 con "…" al posto dei fatti; decompress troncato a 48,8KB |
| full1 | 15 | 0,936M | 0,884 | 5/5 tramite decompress di b1 |

## 4. Difetti trovati e corretti durante le misure

- **`pi -p` restava appeso ~10 minuti dopo ogni compact** (`pi-memory/src/embed.ts`). In Node, un listener `message` aggiunto dopo `worker.unref()` rimette il riferimento sul worker. Così il worker condiviso dell'embedder e5, avviato da `archivio.ts` dopo un compact, teneva vivo il processo finché non scattava l'unload per inattività (10 min). Correzione: il worker ha un riferimento solo mentre carica il modello o mentre c'è una richiesta in attesa, come già faceva `MemoryWorker`. Test in `pi-memory/test/embed-worker.test.ts`: prima della correzione il processo veniva ucciso a 45 s, dopo esce in 1 s.
- **caveman** riassumeva in `session_before_compact` anche quando billion-context annullava il compact: era una chiamata sprecata. Ora cede se il tool `compress` è registrato.
- **lean-tools** rispondeva "invariato" alla rilettura di un file il cui contenuto era già stato compresso. Ora azzera il tracker delle riletture dopo ogni `compress` riuscito.

## 5. Profilo v2 con archivio (3 run per configurazione)

Stesso banco a turni della §2. Storia della sessione: ~636k caratteri (~190k token stimati a 3,3 caratteri per token), 2,4 volte il contesto vivo massimo di v2. "Costo pesato" = input + 0,1·cacheRead + 1,25·cacheWrite + 5·output, cioè i rapporti di prezzo di Anthropic per la cache: è un'equivalenza in token di input, non la bolletta dell'abbonamento.

| Run | Richieste | Token in totali | cacheWrite | Output | Costo pesato | Contesto vivo max | Hit | compress | Compact di Pi | Recall |
|---|---|---|---|---|---|---|---|---|---|---|
| t-off3 | 31 | 2,606M | 1,106M | 3,4k | 1,549M | 123,7k | 0,58 | — | 2 | 6/7 (archivio; 7° troncato, poi corretto) |
| t-off4 | 31 | 2,616M | 1,060M | 3,4k | 1,497M | 123,8k | 0,60 | — | 2 | 7/7 (archivio) |
| t-off5 | 31 | 2,615M | 1,059M | 3,8k | 1,499M | 123,8k | 0,60 | — | 2 | 7/7 (archivio) |
| t-v2 | 44 | 2,447M | 0,793M | 27,0k | 1,292M | 80,8k | 0,68 | 11 | 0 | 7/7 |
| t-v3 | 46 | 2,557M | 0,750M | 24,8k | 1,242M | 81,1k | 0,71 | 11 | 0 | 7/7 |
| t-v4 | 48 | 2,670M | 0,793M | 26,5k | 1,311M | 81,2k | 0,70 | 12 | 0 | 7/7 |
| t-off6 | 31 | 2,605M | 1,054M | 3,2k | 1,486M | 123,7k | 0,60 | — | 2 | 7/7 (archivio; run del controllo del goal) |
| **media off** | 31 | 2,612M | 1,075M | 3,5k | 1,515M | 123,8k | 0,59 | — | 2 | 6,7/7 |
| **media v2** | 46 | 2,558M (−2%) | 0,779M (−28%) | 26,1k | 1,282M (−15%) | 81,0k (−35%) | 0,70 | 11,3 | 0 | 7/7 |

Senza il richiamo automatico dell'archivio (`PI_ARCHIVE_AUTO=0`), una run per lato:

| Run | Token in totali | Costo pesato | Recall | Come |
|---|---|---|---|---|
| t-offna | 2,607M | 1,489M | **0/7** | il compact di Pi ha perso i valori |
| t-v2na | 2,497M | 1,255M | **7/7** | 1 `search_context` più i riassunti di `compress`, che ora tengono i valori |

Prova del ripristino attraverso il bridge (`/tmp/bc-bench/t-dec`, copia della sessione t-v2, `PI_ARCHIVE_AUTO=0`): richiesto esplicitamente, il modello chiama `search_context` e `decompress` e risponde `1200`. 2 `--resume` del bridge, nessun compact di Pi.

Risultati:

- **Token**: i token in totali calano poco (−2% in media, una run su tre sopra off: +2%). Calano molto le scritture in cache (−28%), che sono la voce cara: il costo pesato scende del 15% in tutte e 3 le run. Le richieste in più (46 contro 31) sono le chiamate `compress`, lette quasi tutte dalla cache; l'output sale di ~23k token per i riassunti.
- **Bridge**: v2 riavvia `claude` più spesso (26–27 spawn con 25–26 `--resume`, contro 20 spawn e 15 `--resume` di off): ogni `compress` cambia il prefisso della vista e il pool del bridge non lo riconosce più. Il costo è già dentro i token misurati (le scritture in cache restano comunque −28%), ma ogni riavvio aggiunge latenza.
- **Contesto vivo**: 81k fisso contro 124k, senza nessun compact di Pi. La storia è 2,4 volte il contesto vivo.
- **Memoria**: col solo modello (archivio spento) off richiama 0/7 e v2 7/7. Con l'archivio acceso entrambi arrivano a 7/7: il ponte archivio da solo porta off da 0/7 a 6–7/7 e v2 resta a 7/7. Il guadagno di memoria di v2 viene dal prompt (riassunti che tengono i valori, `search_context` prima di «non so»), non da `decompress`, che il modello usa solo se glielo si chiede.
- **Cosa non è stato provato**: sessioni di ore o giorni, centinaia di turni, domande vaghe senza un identificatore, ripresa in una sessione nuova (l'archivio vale solo dentro la sessione). Le run senza archivio sono una per lato.

## 6. Chat lunga con ripresa (29 turni, profilo vB)

Banco `eval/fold/long.py` con i turni di `long-turns.txt`: fatti dettati dall'utente, 23 letture di file, un conteggio con bash, un `RESTART` (Pi riparte con `--continue`) e lo stesso quiz di 14 valori esatti prima e dopo la ripresa. Modello haiku, finestra di 200k. `long-check.mjs` misura token, contesto vivo, riavvii del bridge e recall; una risposta che si sconfessa («non so (40 era inventato)») conta come mancata. Profilo predefinito vB = v2 + `compress.minPressureBenefitTokens: 30000`.

Run finali (N, tutte le correzioni sotto; 4 run in parallelo, per questo le durate sono più alte):

| Run | Costo pesato | Token in totali | cacheWrite | Output | Contesto vivo max | Compact di Pi | compress | Spawn / `--resume` | Recall |
|---|---|---|---|---|---|---|---|---|---|
| N-off1 | 1,095M | 4,657M | 517k | 6,9k | 122,6k | 4 | — | 15 / 5 | 14/14, 14/14 |
| N-off2 | 1,114M | 4,749M | 516k | 9,0k | 123,1k | 4 | — | 15 / 5 | 14/14, 14/14 |
| N-v1 | 0,975M | 4,193M | 399k | 19,2k | 112,6k | 0 | 4 | 8 / 6 | 14/14, 14/14 |
| N-v2 | 1,000M | 4,311M | 399k | 22,0k | 112,6k | 0 | 5 | 8 / 6 | 14/14, 14/14 |
| **media off** | 1,104M | 4,703M | 517k | 8,0k | 122,8k | 4 | — | 15 / 5 | 14/14 |
| **media vB** | 0,988M (−10,6%) | 4,252M (−9,6%) | 399k (−23%) | 20,6k | 112,6k | 0 | 4,5 | 8 / 6 | 14/14 |

Prima delle correzioni (run J, stesso banco) vB costava l'1% in più di off (1,097M contro 1,084M), riavviava `claude` 10 volte e perdeva 1–2 valori su 14 a ogni quiz (il modello dell'estensione vault, la larghezza del pannello).

Difetti trovati con la chat lunga e corretti:

- **Tool result persi alla ripresa** (`pi-claude-code/src/claude-transcript.ts`): i risultati dei tool in coda alla storia non venivano scritti nella sessione ripresa da `--resume`. Test `transcript-trailing.test.ts`.
- **JSON malformato a `compress`**: haiku chiudeva male le parentesi dell'argomento; il bridge ora riprende la sessione con l'errore di Claude Code (InputValidationError con la coda dell'input, `__unparsedToolInput`) e il prompt del profilo dice come chiudere gli oggetti. Nei run J e N: 0 input non letti.
- **Il pool del bridge chiudeva la sessione principale mentre aspettava un tool result**: `evictOverflow` (`idle-reaper.ts`) non chiude mai una sessione occupata né la più recente; escono prima le morte, poi quelle di una sola richiesta, poi la meno usata. Test `evict-overflow.test.ts`.
- **Riavvio di `claude` a ogni troncatura d'emergenza**: sopra il 95% del limite billion-context tronca i messaggi lunghi (2000 caratteri per estremo) e li rimanda interi quando l'uso scende; il messaggio della skill attivata cambiava così impronta a richieste alterne (`diverged at 1/17` nel log) e ogni volta il bridge ripartiva con una scrittura piena della cache. Ora l'impronta di un messaggio utente lungo si calcola sui suoi estremi, senza il marcatore di troncatura né la dimensione nel tag `<acp>` (`fingerprintMessage`, test `fingerprint.test.ts`). Run N: 0 divergenze, spawn da 10 a 8.
- **Valori di file descritti a parole persi**: le domande «il modello di embedding dell'estensione vault» e «la larghezza del pannello di pi-ui» non hanno identificatori, quindi `keyRecall` non le copre; i riassunti di `compress` tengono cosa fa un file, non le costanti, e panel.ts, ancora vivo, era troncato dalla troncatura d'emergenza prima di `PANEL_WIDTH`. Un prompt più insistente su `search_context` non è servito (run M: 12–13/14). `constRecall` (`extensions/archivio.ts`) manda le costanti di primo livello dei file letti che la domanda nomina per segmento di percorso (`vault`, `pi-ui`): in tutta la chat lunga scatta solo ai 2 quiz, ~570 caratteri l'uno. Il recall semantico per singola domanda era stato scartato prima: vault al rank 13 e panel al 113 su 738 chunk.
- **Check della chat lunga**: il conteggio atteso delle righe ora viene dall'output di `wc` del run (il valore fisso era superato).

Altri profili provati sullo stesso banco e scartati: limite 200000 (12 compact di Pi), `minPressureBenefitTokens` 50000 (7 compact di Pi), limite 130000 (nessun vantaggio). Nella suite i test di tempo di pi-memory (`async-build`, blocco dell'event loop < 150 ms) falliscono a volte quando girano sotto carico (161 ms con 4 chat lunghe in parallelo); da soli passano.

## 7. Pagliaio: recall di fatti lontani (H1 sintetico, R1 da sessione vera)

H1: 158 turni con haiku, 19 domande divise in due quiz (prima e dopo la ripresa); `eval/fold/haystack/gen.py`. R1: 71 turni ricavati da una sessione vera, 14 domande; `gen-real.py`, mentre il contenuto resta fuori dalla repo. Costo pesato = input + 0,1·cacheRead + 1,25·cacheWrite + 5·output. «Non so» su un fatto dato conta come errore.

| run | punteggio | costo pesato | avvii di claude | tool di contesto nei quiz |
|---|---|---|---|---|
| H1-off | 13/19 | 8,17M | 102 | nessuno |
| H1-off-noarch | 11/19 | 7,57M | 114 | nessuno |
| H1-bc | 11/19 | 6,11M (−25%) | 34 | nessuno |
| H1-bc-noarch | 5/19 | 6,26M | 36 | nessuno |
| H1-bc-rn (spinta + fix `closeOrphaned`) | 14/19 | 6,47M (−21% su H1-off) | 35, nessun processo rimasto vivo | `search_context` 21, `decompress` 5 |
| R1-off | 5/14 | 3,88M | 64 | nessuno |
| R1-bc | 5/14 | 3,99M | 25 | `search_context` 14, `decompress` 1 (solo nel quiz 2) |
| R1-bc-noarch | 12/14 | 3,84M | 22 | `search_context` 20 |

- Con billion-context il costo scende del 25% su H1. Il recall però dipende dal fatto che il modello cerchi: dove ha cercato (R1-bc-noarch) ha preso 12/14, dove non ha cercato ha risposto «non detto».
- In tutte le run sbagliano allo stesso modo i valori aggiornati (porta, scadenza) e la domanda di controllo di R1 sulle «tappe».

### Spinta al recall (`extensions/recall-nudge.ts`)

L'estensione interviene su `agent_before_settle` solo se valgono tutte queste condizioni:
- billion-context ha compresso qualcosa (file a fianco `*.acp.json`);
- l'ultima risposta contiene un'astensione;
- dopo l'ultimo messaggio dell'utente non c'è stato né `search_context` né `decompress`;
- dopo l'ultimo messaggio dell'utente non c'è già stata una spinta.

Quando interviene, aggiunge un messaggio nascosto e chiede una sola continuazione. Il costo fisso è zero; si spegne con `PI_RECALL_NUDGE=0`.

- Il regex, applicato alle risposte finali di tutte le run H1 e R1, scatta solo sui 2 turni di quiz di ciascuna run e mai sui 154 (H1) e 69 (R1) turni normali.
- Ripresa della sessione H1-bc finita, con una sola ripetizione del quiz 2:
  - la spinta è scattata e il modello ha fatto 4 `search_context` e 1 `decompress`;
  - punteggio da 6/9 a 7/9: la scadenza superata è stata corretta, 2 fatti restano «non detto», l'astensione di controllo resta giusta;
  - costo della spinta: 69k token pesati su quella domanda (prima risposta 7k), circa l'1% di una run H1.
- Run completa H1-bc-rn, con la spinta e il fix `closeOrphaned`:
  - punteggio 14/19, contro 13/19 di H1-off e 11/19 della vecchia H1-bc;
  - nel quiz 1 la spinta porta da 5/10 a 8/10 (slot, righe `wc`, nome in codice);
  - costo pesato 6,47M, cioè −21% su H1-off e +6% sulla vecchia H1-bc, per il costo delle ricerche;
  - 35 avvii di `claude` contro 102 di H1-off, nessun processo rimasto vivo a fine run (prima del fix erano 21 su 22);
  - durata 871 s contro 6.895 s della vecchia H1-bc: senza i processi orfani nessuna richiesta resta in coda;
  - le 5 compattazioni di Pi sono state tutte annullate da billion-context, come previsto;
  - restano sbagliati i valori aggiornati (porta, scadenza) e 3 fatti letti in file mai nominati nelle domande.
- `score.mjs` ora valuta l'ultimo blocco «RISPOSTE:» del turno: con la spinta il modello risponde due volte e prima veniva valutata la risposta data prima di cercare. Le run precedenti, riscorate, hanno gli stessi punteggi.
- Limite: una sola run per configurazione; la differenza tra 14/19 e 13/19 sta dentro il rumore, il risparmio di costo no.

### Valori aggiornati (porta, scadenza)
- Causa, misurata sullo stato di billion-context a fine H1-bc-rn:
  - l'aggiornamento («la porta è cambiata, ora è 9124… scadenza slittata a 7 gennaio») stava nei blocchi b40 e b41, che segnava anche 8817 come superato;
  - b43, rifondendo b41 e b42, ha riscritto la nota vecchia «porta 8817» e perso il valore nuovo, e nessun blocco attivo lo contiene più;
  - 16 riassunti attivi ripetono i fatti iniziali (8817, 15 dicembre), quindi il modello li trova nel contesto e non cerca;
  - l'archivio peggiorava le cose: `factRecall` iniettava il messaggio vecchio, perché ha più parole in comune con la domanda (porta) o vince il pareggio (scadenza), e mai l'aggiornamento.
- Correzione in `extensions/archivio.ts`, `factRecall`:
  - dopo il fatto scelto aggiunge i messaggi successivi dell'utente con gli stessi termini (tutti tranne al più uno) e un segnale di aggiornamento («cambiata», «ora è», «slittata»…), marcati «più recente»;
  - lo fa anche quando il messaggio vecchio è già stato mandato per un'altra voce della domanda;
  - «attuale», «corrente», «ultimo» non pesano più nella soglia: sono qualificatori della domanda, non parole del fatto.
- Verifica offline sui 158 turni di H1-bc-rn: l'aggiornamento compare solo nei 2 quiz, mai nei 156 turni normali; costo dell'iniezione circa +38 token in tutta la sessione.
- Replay dei due quiz su uno stato pulito (sessione troncata prima del quiz 1, tolti i blocchi b56 e b57 nati durante il quiz):
  - porta 9124 e scadenza 7 gennaio corrette già alla prima risposta, prima di ogni ricerca;
  - punteggio dello scorer 18/19 (10/10 e 8/9) contro 14/19 di H1-bc-rn; manca «giorni reso» (non detto). Il 13.750 del quiz 1 il modello lo ha trovato con `bash` sui dump di `decompress`, cosa che la domanda vietava: senza, 16/19. Una prima versione di questo report diceva 18/19 per un conteggio a mano sbagliato;
  - un secondo replay con il codice successivo (cache del recall, aggiornamenti a catena) dà di nuovo 18/19 con lo stesso errore, ma costa 362k pesati: il modello ha usato `codemode` e un `compress`. Il costo dei due turni varia quindi tra 278k e 362k, contro i 370k di H1-bc-rn;
  - costo dei due turni 278k pesati contro 370k.
- Limite: un solo replay dei due quiz, non una run completa.

### Perché «giorni reso» non tornava (2026-11-23)

Manca in tutte e 5 le run H1, anche in H1-off senza compressione: non è un difetto di billion-context da solo. La domanda «quanti giorni hanno i clienti per fare un reso» chiede la costante `RETURN_WINDOW_DAYS = 41` di `src/returns/returns-service.ts`, letta dal modello 600 turni prima. Ogni anello della catena la perdeva:

- **Riassunti di `compress`.** Il blocco b6 elenca le costanti stringa del file (`"volume-219"`, `"rate-339"`) ma non quella numerica.
- **`constRecall`.** Scatta solo se la domanda nomina il file per segmento di percorso; «reso» non è «returns».
- **`search_context`.** Il modello cercava in inglese («giorni reso return window clienti»), ma riceveva riassunti di blocchi senza il numero. Ha decompresso i blocchi e non ha letto i dump.
- **`search` dell'archivio.** Deduplicava i risultati con i primi 40 caratteri del chunk. Tutti i chunk di un file letto iniziano con lo stesso prefisso `<{"path":…}>`, quindi da ogni file usciva un solo chunk; con `RETURN_WINDOW_DAYS` come query, la definizione non compariva nemmeno tra 5.000 risultati. Ora la chiave è il testo intero (test `search keeps every matching chunk…`). Sul recall iniettato in H1-bc-rn e R1-bc l'effetto è nullo: 0 differenze su 229 prompt, perché lì il chunk vincente era già il primo.

Correzione: `constSearch` (`extensions/archivio.ts`) aggancia il risultato di `search_context` e aggiunge le costanti di primo livello dei file letti il cui nome è composto da almeno due parole della ricerca (anche come prefisso: «returns» copre `RETURN`). Restituisce solo i nomi con il punteggio migliore, al più 3.

- Verifica offline sulle 55 ricerche vere dei run H1-bc-rn, R1-bc e R1-bc-noarch (`/tmp/cs-real.mts`):
  - scatta 3 volte, sempre sulla costante giusta: 41, 7,25 e 23;
  - nessuna esca (`RETURN_LABEL_DAYS`, `TOKEN_WINDOW_DAYS`) e 0 attivazioni su R1;
  - 361 caratteri aggiunti in tutto, 4–9 ms per ricerca.
- Replay dei due quiz con lo stesso stato (`/tmp/rn-replay4`):
  - quiz 2 9/9: il 41 e il 7,25 arrivano dalle righe aggiunte, con file e nome della costante;
  - quiz 1 7/10 contro 9/10. Lì `constSearch` non è mai scattato; lo slot sbagliato (`LANE_SLOT_MS`) viene da un `grep` del modello sui dump di `decompress`, e il 13.750 non è stato trovato. Variabilità del modello, misurata su un solo replay;
  - scorer 17/19 contro 18/19; costo 145k pesati contro 362k e 278k dei replay precedenti.
- Restavano fuori i valori cercati con parole che non compongono il nome: `REQUEST_DEADLINE_MS` cercato come «timeout», `SLOT_LENGTH_MIN` come «durata slot dock scheduler».

Estensione ai file nominati: se le parole della ricerca nominano un file letto, tornano tutte le sue costanti di primo livello su una riga, prima quelle con una parola in comune con la ricerca.
- Il file è nominato quando tutte le parti del nome sono nella ricerca, per esempio «dock scheduler» o «carrier-client». Un nome di una sola parola richiede anche la cartella.
- Limiti: al più 2 file, 700 caratteri per file; le costanti già trovate per nome non si ripetono.
- Verifica offline (`/tmp/cs-real.mts`):
  - H1-bc-rn: 11 ricerche su 21 fanno scattare `constSearch`, per 4.169 caratteri in tutto (circa 1.000 token);
  - R1-bc e R1-bc-noarch: 0 su 34;
  - la riga del file contiene il valore giusto, 13_750 o 25, e mai l'esca `REQUEST_TIMEOUT_MS`;
  - 4–7 ms per ricerca.
- Replay con lo stesso stato (`/tmp/rn-replay5`):
  - quiz 1 9/10: il 13_750 e il 25 arrivano dalle righe aggiunte; nessun errore;
  - quiz 2 9/9;
  - scorer **19/19**, contro 17/19 e 18/19 dei replay precedenti e 14/19 di H1-bc-rn;
  - costo 137k pesati, maxCtx 74k.
- Limite: un solo replay per versione, con haiku.

### «Nome in codice» nei replay: errore dello scorer (2026-11-23)

Nei replay la risposta era giusta: il modello scrive «Nerofiume», il nome proposto al turno 13 di H1-bc-rn. Lo scorer prende il nome atteso dal turno 13 degli eventi della run, ma un replay riparte da una sessione troncata e ha solo i 2 turni del quiz. Il nome atteso diventava quindi `\0` e la risposta contava come sbagliata.

Correzione: `truth.json` ha il campo `assistantPrompt`, scritto da `gen.py`. Se il turno manca negli eventi, `score.mjs` cerca nel file di sessione la risposta a quel prompt (test in `score.test.mjs`).

Punteggi ricalcolati:
- run complete H1 invariate: 13, 11, 11, 5 e 14 su 19;
- replay +1: 18/19, 18/19, 17/19 e **19/19** per l'ultimo con `constSearch` esteso ai file nominati.

### Variabilità dei replay (2026-11-23)

Altri 3 replay identici con il codice attuale e lo stesso stato pulito (`/tmp/rn-var/r1..r3`, haiku). Insieme a `/tmp/rn-replay5` sono 4 prove:

| replay | quiz 1 | quiz 2 | totale | pesato | maxCtx |
|---|---|---|---|---|---|
| rn-replay5 | 10/10 | 9/9 | 19/19 | 137k | 74k |
| r1 | 10/10 | 9/9 | 19/19 | 131k | 73k |
| r2 | 10/10 | 9/9 | 19/19 | 149k | 92k |
| r3 | 9/10 | 9/9 | 18/19 | 356k | 106k |

- Media 18,75/19 contro 14/19 della run H1-bc-rn e 17–18/19 dei replay prima di `constSearch`.
- r3 è l'unico diverso. Il modello ha cercato prima su un file sbagliato (`depot-scheduler`) e ha chiamato un `compress` a metà quiz, che da solo spiega il costo più che doppio. Ha mancato solo il totale di `wc -l` («righe wc»), che sta nei dump di `decompress`, non in un file letto.
- Le ricerche con i file nominati hanno riportato 13_750 e 25 in tutte e 4 le prove.
- Secondo difetto dello scorer, corretto: in r3 la risposta 6) era «13750 ms, costante `REQUEST_DEADLINE_MS`…; nessuna descrizione esplicita». La parola «nessun» la faceva contare come astensione. Ora un valore giusto conta come astensione solo se la frase di astensione lo precede (test in `score.test.mjs`). Le run H1 e i replay precedenti non cambiano punteggio.
- Processi `claude` durante e dopo i replay: nessuno rimasto dalle prove; gli unici vivi erano quelli di opus della sessione di lavoro.

### Qualità della decompressione (2026-11-23)

Script in `/tmp/dec-fid.py` e `/tmp/dec-use.py`. Misura su H1-bc-rn e sui 9 replay.

Fedeltà: 10 blocchi ripristinati da `decompress` (b1, b2, b3, b5, b6, b9, b20, b31, b35, b39; 1,85M caratteri) confrontati con i messaggi originali della sessione.
- Il 100% del testo torna alla lettera: messaggi utente, risposte del modello, argomenti dei tool e risultati dei tool. L'unica differenza è il JSON degli argomenti, scritto in forma compatta.
- 3 messaggi su 1.851 non risolti (2 in b20, 1 in b39).
- Rapporto originale/riassunto da 37x a 232x (b20: 622k caratteri contro un riassunto di 2,7k).

Cosa resta senza decompressione: nella sessione prima del quiz, 34 blocchi attivi hanno 48k caratteri di riassunti. Contengono 9 dei 16 valori del quiz (ticket, referente, cliente, budget, code, slot, righe `wc`, chiave del manifest, sovrapprezzo). Gli altri 7 stanno solo negli originali: porta staging, scadenza (valori aggiornati), `CUSTOMS_HOLD_HOURS`, `LABEL_DPI`, deadline corrieri, `FLEET_IDLE_ALERT_MIN` e giorni reso. Il controllo è per regex: il `\b25\b` dello slot può comparire per caso.

Uso nelle run:
- modalità file (predefinita): circa 850 caratteri per chiamata (percorso e anteprima di 600). Il modello poi legge solo le righe che servono con `bash`/`grep` sul dump, da 375 a 9.007 caratteri per quiz;
- modalità `inline: true`: 30k caratteri per blocco, 150k per quiz (circa 37k token). È successo in H1-bc-rn e r3: in r3 è la causa del costo di 356k pesati contro 131–149k;
- valori arrivati solo dalla decompressione: «righe wc» in 4 replay su 4 con `constSearch`; prima di `constSearch` anche deadline corrieri e `FLEET_IDLE_ALERT_MIN`; in r3 il sovrapprezzo;
- H1-bc e H1-bc-noarch non l'hanno mai chiamata.

Sintesi: l'originale torna senza perdite, e in modalità file costa poco. I limiti sono altri: il modello deve sapere quale blocco aprire, e quando sceglie `inline` il costo sale di decine di migliaia di token.

### Riassunti troncati o troppo corti? (2026-11-23, billion-context#6927)

Script in `/tmp/summ-check.py`, `/tmp/summ-chain.py` e `/tmp/summ-merge.py`, su H1-bc, H1-bc-noarch, H1-bc-rn, R1-bc e R1-bc-noarch (231 blocchi).
- Troncati: nessuno. Nessun riassunto finisce con `…` o `...`, nessuno ha un numero dispari di ```, tutti finiscono con una frase completa.
- Corti: il minimo è 324 caratteri per 25k token (b17 di H1-bc-noarch), la mediana 0,09–0,11 caratteri per token. I più corti coprono letture di file; i blocchi da circa 6k token (una lettura) hanno 400–630 caratteri. Descrivono il file e citano 2–3 costanti a caso, non quelle chieste dal quiz. È una scelta del riassunto, non un troncamento.
- Il difetto vero è un altro: la perdita quando il modello ricomprime blocchi già compressi in un blocco nuovo.
  - Nel blocco nuovo sopravvivono solo il 15–16% dei numeri, dei nomi `UPPER_CASE` e dei file citati dai riassunti figli su H1, e il 23–31% su R1. Il caso peggiore è b47 di H1-bc-rn: 5% di 185.
  - Porta 9124 e scadenza 7 gennaio sono scritte bene nel riassunto di b40 (H1-bc-rn) e di b36 (H1-bc). Si perdono al secondo passaggio (b43 e b37) e non sono nel blocco attivo al momento del quiz. Lo stesso per `FLEET_IDLE_ALERT_MIN` (b47 in H1-bc-rn; b9 in H1-bc, insieme a «righe wc» e alla chiave del manifest).
  - In H1 buona parte dei «fatti» sono nomi di costanti di riempimento, quindi una ritenzione bassa è in parte attesa. Gli aggiornamenti dell'utente non lo sono.
- Effetto: senza archivio né `decompress` i valori aggiornati tornano vecchi o mancano. È il caso di H1-bc-noarch, 5/19. L'originale resta recuperabile (fedeltà 100%, vedi sopra), e oggi è l'archivio a riportarlo.
- Upstream: #6927 copre solo troncamento e rapporto minimo, non la perdita tra un passaggio e l'altro. acp-kernel#442 (chiusa) riguardava gli obiettivi aperti persi tra i passaggi, non i fatti.

#### Riportare i fatti dei figli nella ricompressione? (2026-11-23) — no

Fattibile: in Pi `tool_call` può modificare `event.input`, quindi un'estensione potrebbe aggiungere al `summary` di `compress` i fatti dei blocchi assorbiti. Simulazione offline sulle 5 run (`/tmp/carry-sim.py`), contando i valori del quiz presenti nei blocchi attivi a fine sessione:

| run | solo frasi dell'utente con un valore | tutti i numeri e nomi `UPPER_CASE` |
|---|---|---|
| H1-bc-rn | +1.904 car., 11 → 11/16 | +25.357 car., 11 → 13/16 |
| H1-bc-noarch | +9.264 car., 12 → 13/16 | +56.225 car., 12 → 13/16 |
| H1-bc | +9.783 car., 12 → 14/16 | +45.029 car., 12 → 15/16 |
| R1-bc | +257 car., 9 → 9/12 | +23.281 car., 9 → 10/12 |
| R1-bc-noarch | +7.696 car., 12 → 12/12 | +24.764 car., 12 → 12/12 |

- La variante completa costa 6–14k token in più nel contesto per tutta la sessione e recupera 0–3 valori.
- Quella selettiva costa meno ma recupera 0–2 valori. Riconoscere le frasi dell'utente nel testo libero del riassunto è fragile: su H1-bc-rn porta e scadenza non vengono riprese.
- Gli stessi valori li riporta già l'archivio, a costo zero quando non servono: 18,75/19 di media nei replay.
- Decisione: non si implementa. Si riconsidera solo se una run senza archivio diventa un caso d'uso.

#### `decompress` di un blocco sempre su file (2026-11-23)

- Il modello ha chiesto `inline: true` su blocchi interi in H1-bc-rn (b1, b3, b5) e in r3 (b5 due volte, b6), circa 50k caratteri per chiamata. Tutti i blocchi coprono almeno 6k token, quindi non esiste un blocco «piccolo» per cui `inline` convenga.
- `extensions/recall-nudge.ts` toglie `inline` da `decompress` quando `blockId` è un blocco (`b\d+`), con un hook su `tool_call` (costo fisso zero). I riferimenti a singoli messaggi restano inline. Test in `recall-nudge.test.ts`.
- In modalità file il risultato è di circa 850 caratteri con anteprima, e il modello cerca nel dump con `grep`: è il caso di r1, r2, UP3, UP4 e r4.
- Replay r4 dopo la modifica: 19/19, 204k pesati, maxCtx 75k. Il modello non ha chiesto `inline` (1 `decompress` su file, 1 `grep` sul dump), quindi l'hook non è scattato in questo replay. Il risparmio atteso per ogni chiamata evitata è di circa 12k token, valore stimato da r3 e non ancora misurato con l'hook attivo.

### Giro completo H1 con il codice attuale (2026-11-23, H1-bc-v2)

`eval/fold/haystack/run.sh H1-bc-v2 bc`, haiku, 158 turni, 922 s. Codice: archivio con aggiornamenti a catena e `constSearch`, spinta al recall, `decompress` dei blocchi sempre su file.

| run | quiz | pesato | maxCtx | richieste |
|---|---|---|---|---|
| H1-off (Pi + archivio) | 13/19 | 8,17M | 124k | 423 |
| H1-bc-rn | 14/19 | 6,47M | 170k | 344 |
| **H1-bc-v2** | **17/19** | **6,51M** | **116k** | 347 |

- Costo −20% rispetto a H1-off, contesto massimo −7% (−32% rispetto a H1-bc-rn).
- Porta 9124 e scadenza 7 gennaio corrette, quiz 2 9/9; timeout corrieri (13750) e slot banchine (25) trovati.
- Errori: «righe wc» e «nome in codice» (proposto «Vela»). Il modello ha individuato i blocchi giusti (b7, b5) e chiesto `inline`; l'hook li ha mandati su file (848 caratteri invece di circa 50k ciascuno). Il quiz vieta `read`, `bash` e `grep`, quindi non ha letto i dump e ha risposto «non verificato». È un limite del quiz combinato con la modalità file. Nell'uso normale la lettura del dump è permessa, ma la risposta corretta non è misurata.
- Affidabilità: 36 spawn e 34 riprese senza errori, nessun processo `claude` rimasto. Suite completa 1148 pass e 0 fail, bridge 40/40.
- R1 non rilanciata (circa 1,8 ore): i dati R1 restano quelli precedenti alle correzioni (R1-off 5/14, R1-bc 5/14, R1-bc-noarch 12/14).

### Giro R1 con il codice attuale (2026-11-23, R1-bc-v2)

`run.sh R1-bc-v2 bc /tmp/bc-real`, haiku, 71 turni. Haiku era lento (7,2 token/s in uscita contro 11,3 della run precedente; 15.355 s in tutto contro 6.661), quindi il limite `perl alarm` è scattato. Il segnale ha fermato solo `sh`: `long.py` ha continuato e ha finito la run. Credendola interrotta, ho ripreso la stessa sessione dal turno 59 (R1-bc-v2b): per circa 1,5 ore due processi hanno scritto sullo stesso file di sessione e sullo stesso `.acp.json`. Il contenuto letto è lo stesso registro, ma la misura non è pulita: va ripetuta prima di trarre conclusioni forti.

| run | quiz 1 | quiz 2 | totale | pesato | maxCtx |
|---|---|---|---|---|---|
| R1-off (Pi + archivio) | 3/7 | 2/7 | 5/14 | 3,88M | 128k |
| R1-bc (prima delle correzioni) | 1/7 | 4/7 | 5/14 | 3,99M | 132k |
| R1-bc-noarch | 6/7 | 6/7 | 12/14 | 3,84M | 135k |
| **R1-bc-v2** | 5/7 | 5/7 | **10/14** | **4,46M** | 142k |
| R1-bc-v2b (ripresa dal turno 59) | 6/7 | 5/7 | 11/14 | +1,10M | 137k |

- Memoria: 10–11/14 contro 5/14 di R1-off e R1-bc. Errori ricorrenti: «fix non uniti» (astensione), «durata e2e» (astensione), «tappe» (sbagliato in tutte le run).
- Token: su R1 billion-context non risparmia, anzi costa +15% rispetto a R1-off (4,46M contro 3,88M). Il quiz usa 23 `search_context` e 25 `decompress` (24 nel quiz 2, quasi tutti su riferimenti di messaggio tramite `codemode`). Su H1 invece costa −20%.
- Avvertenza per le prossime run: `perl alarm` su `sh run.sh` non ferma `long.py`. Va messo direttamente su `python3` oppure va terminato il gruppo di processi.

### R1 ripetuta pulita (2026-11-23, R1-bc-v3)

Limite di tempo sull'intero gruppo di processi (`/tmp/grp-timeout.pl`: `setpgrp`, poi `kill` di `-pgid`; verificato con un processo nipote). Run unica e senza interferenze, 656 s (haiku veloce, contro i 15.355 s della v2).

| run | quiz 1 | quiz 2 | totale | pesato | maxCtx | output ×5 | cacheWrite ×1,25 |
|---|---|---|---|---|---|---|---|
| R1-off | 3/7 | 2/7 | 5/14 | 3,88M | 128k | 0,15M | 2,57M |
| R1-bc-noarch | 6/7 | 6/7 | 12/14 | 3,84M | 135k | 0,44M | 2,20M |
| **R1-bc-v3** | 5/7 | 5/7 | **10/14** | **4,28M** | 137k | 0,46M | 2,54M |

- Memoria: 10/14, come la v2 sporca, quindi il risultato regge. Errori: «cartella link», «fix non uniti», «commit ADR», «METR», tutti per astensione. Nei quiz 14 `search_context` e nessun `decompress`.
- Token: +10% rispetto a R1-off. La differenza viene dai riassunti scritti dal modello (output da 0,15M a 0,46M), mentre le scritture in cache non calano (2,54M contro 2,57M). Su R1 la sessione è corta rispetto alla finestra, quindi la compressione non ripaga il costo dei riassunti. Su H1 (158 turni) costa invece −20%.
- R1-bc-noarch resta migliore su entrambi i fronti: 12/14 e 3,84M. Con 1 run per configurazione la differenza di 2 domande non è significativa: nei replay H1 la variabilità era di 1 domanda su 19.
- Affidabilità: 26 spawn e 24 riprese, nessun errore in stderr, nessun processo rimasto.

### `search_context` più preciso: passaggi esatti (2026-11-24)

Problema (R1-bc-v3): le 4 risposte mancate erano tutte nella sessione, dentro letture da 15–40k caratteri. `search_context` di billion-context restituisce riassunti di blocco e messaggi interi con un'anteprima di 180 caratteri attorno alla **prima** parola della query, quindi il valore restava fuori. Esempio: «percentuale fix proposti agenti non uniti» → 5 riassunti di blocco, nessuno con il 46%.

Soluzione (`extensions/archivio.ts`, `passageSearch`): l'hook `tool_result` su `search_context` aggiunge fino a 3 passaggi esatti dei messaggi compressi. Si usa BM25 su pezzi da 900 caratteri, con almeno 2 parole della query; ogni pezzo è tagliato alla finestra di 360 caratteri che contiene più parole distinte della query. Ogni passaggio riporta l'id del messaggio, che `decompress` accetta. I messaggi ancora visibili sono esclusi, e `PI_ARCHIVE_PASSAGE=0` disattiva la funzione. Test: 3 nuovi in `archivio.test.ts` (29/29).

Copertura offline (le query reali dei quiz rigiocate sulle sessioni salvate; conta quante risposte compaiono nei risultati):

| sessione | solo upstream | upstream + passaggi |
|---|---|---|
| R1-bc-v3 | 8/12 | 10/12 |
| R1-bc | 6/12 | 7/12 |
| H1-bc-v2 | 9/17 | 10/17 |

Costo: circa 1.100 caratteri (~300 token) per ricerca e 11–15 ms.

Replay dei 2 quiz sulla sessione R1-bc-v3, tagliata alla prima domanda (`/tmp/r1-var.sh`, 2 run per lato):

| | quiz 1 | quiz 2 | totale | pesato |
|---|---|---|---|---|
| passaggi, run 1 | 7/7 | 6/7 | 13/14 | 216k |
| passaggi, run 2 | 7/7 | 7/7 | **14/14** | 152k |
| senza, run 1 | 4/7 | 5/7 | 9/14 | 156k |
| senza, run 2 | 6/7 | 5/7 | 11/14 | 237k |

- Le risposte sono state controllate a mano: 46,41%, f54a2e1, +19%, «nove» tappe e il 403 sono corretti. «Tappe», sbagliata in tutte le run precedenti, ora è giusta 3 volte su 4.
- Media 13,5/14 contro 10/14. Costo simile: 184k contro 197k pesati, perché meno ricerche a vuoto compensano i passaggi in più.
- Limite: è un replay dei soli quiz con 2 run per lato.

Run R1 completa con i brani (R1-bc-v4, 71 turni, 707 s, timeout sul gruppo di processi):

| run | quiz 1 | quiz 2 | totale | pesato | maxCtx |
|---|---|---|---|---|---|
| R1-off | 3/7 | 2/7 | 5/14 | 3,88M | 128k |
| R1-bc-noarch | 6/7 | 6/7 | 12/14 | 3,84M | 135k |
| R1-bc-v3 | 5/7 | 5/7 | 10/14 | 4,28M | 137k |
| **R1-bc-v4** | **7/7** | 5/7 | **12/14** | **4,03M** | 128k |

- Memoria: 12/14, contro 10/14 senza brani. Il quiz 1 è pieno per la prima volta; le 4 astensioni di v3 sono tutte risolte.
- Token: 4,03M, +4% rispetto a R1-off (v3 era +10%). Le scritture in cache scendono da 2,54M a 2,30M; l'output resta più alto di off (0,51M contro 0,15M) per i riassunti di `compress`.
- Errori: «tappe» (8 invece di 9: il registro dice «tappa 0 di 8», un caso difficile già sbagliato in tutte le run) e «revisore» inventato. Nel secondo caso il modello si era astenuto correttamente; poi la spinta `recall-nudge` lo ha fatto cercare di nuovo e un brano su un altro ADR («ADR 0017 … approvata da Federico») gli ha fatto cambiare risposta. È un rischio nuovo: brani esatti ma vicini alla domanda possono trasformare un'astensione giusta in un'invenzione.
- Affidabilità: 25 spawn e 23 riprese, nessun errore, nessun processo rimasto.


## Conclusione

Il profilo v2 tiene il contesto vivo a ~81k invece di 124k, non fa mai partire il compact di Pi, costa il 15% in meno in costo pesato (−2% di token in totali) e richiama tutti i 7 valori esatti anche senza l'archivio, dove off ne richiama 0. Nella chat lunga con ripresa (§6) il profilo predefinito vB costa il 10,6% in meno di off, riavvia il bridge 8 volte invece di 15, non fa compact di Pi e richiama 14 valori su 14 prima e dopo la ripresa. Le misure delle §2–3 (profilo lean, senza finestra di lavoro né archivio) restano valide per quel profilo: costava dal 3 al 17% in più.

Alternative di integrazione con Claude Code (proxy `bili`, hook nativi, context editing), con fonti: `ricerca-integrazione-claude.md`.

## Riprodurre

`eval/fold/turns.sh <label> [-e <percorso>/dist/index.js]`: uscita in `$OUT/<label>` (default `/tmp/bc-bench`). La cartella di lavoro si sceglie con `RUN_CWD`; il suo `.pi/acp.json` decide il profilo. Analisi con `node eval/fold/analyze.mjs $OUT/<label>`. Lo shim `claude` registra gli spawn e i `--resume` in `$SHIM_LOG`; `REAL_CLAUDE` indica il binario vero. I numeri grezzi sono in `results.txt`; `node eval/fold/check.mjs` verifica offline che le medie v2 (t-v2…t-v4) stiano sotto off (t-off3…t-off5) per token in totali, costo pesato, contesto vivo e compact di Pi. Chat lunga: `python3 -I eval/fold/long.py <label> eval/fold/long-turns.txt [-e <percorso>/dist/index.js]` (cartella con `RUN_CWD`, log del bridge con `PI_CLAUDE_DEBUG`), analisi con `node eval/fold/long-check.mjs /tmp/bc-bench/<label>`; `check.mjs` verifica anche le run N registrate come `long-N-*`.
