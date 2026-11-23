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
- Limite: è una sola ripresa di un solo quiz, su una sessione che conteneva già la risposta precedente. Manca una run completa con la spinta attiva.

## Conclusione

Il profilo v2 tiene il contesto vivo a ~81k invece di 124k, non fa mai partire il compact di Pi, costa il 15% in meno in costo pesato (−2% di token in totali) e richiama tutti i 7 valori esatti anche senza l'archivio, dove off ne richiama 0. Nella chat lunga con ripresa (§6) il profilo predefinito vB costa il 10,6% in meno di off, riavvia il bridge 8 volte invece di 15, non fa compact di Pi e richiama 14 valori su 14 prima e dopo la ripresa. Le misure delle §2–3 (profilo lean, senza finestra di lavoro né archivio) restano valide per quel profilo: costava dal 3 al 17% in più.

Alternative di integrazione con Claude Code (proxy `bili`, hook nativi, context editing), con fonti: `ricerca-integrazione-claude.md`.

## Riprodurre

`eval/fold/turns.sh <label> [-e <percorso>/dist/index.js]`: uscita in `$OUT/<label>` (default `/tmp/bc-bench`). La cartella di lavoro si sceglie con `RUN_CWD`; il suo `.pi/acp.json` decide il profilo. Analisi con `node eval/fold/analyze.mjs $OUT/<label>`. Lo shim `claude` registra gli spawn e i `--resume` in `$SHIM_LOG`; `REAL_CLAUDE` indica il binario vero. I numeri grezzi sono in `results.txt`; `node eval/fold/check.mjs` verifica offline che le medie v2 (t-v2…t-v4) stiano sotto off (t-off3…t-off5) per token in totali, costo pesato, contesto vivo e compact di Pi. Chat lunga: `python3 -I eval/fold/long.py <label> eval/fold/long-turns.txt [-e <percorso>/dist/index.js]` (cartella con `RUN_CWD`, log del bridge con `PI_CLAUDE_DEBUG`), analisi con `node eval/fold/long-check.mjs /tmp/bc-bench/<label>`; `check.mjs` verifica anche le run N registrate come `long-N-*`.
