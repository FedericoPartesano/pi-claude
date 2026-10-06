# Memoria "umana" per Pi (`/dream`): porta vantaggi reali? — 2026-10-06

Valutazione empirica di `extensions/memory.ts` (spec: `docs/specs/2026-10-06-memory-dream-design.md`), ispirata al video
sul consolidamento della memoria ("Dreams", `docs/research/2026-10-06-video-dreams-memory.md`).
Pi 1.0.4, bridge `claude-code`, modello Sonnet per i compiti, Haiku per `/dream`. 10 test (5 compiti × 2 bracci).

## In breve
- **Sì, vantaggio reale sulla qualità**: regole già insegnate rispettate **dal 67% al 100%** (giro definitivo), dal 73% al
  95% nel primo giro. Nessun compito con memoria ha violato una regola; senza memoria 5 violazioni su 15 applicabili.
- **Costo contenuto e misurato**: la memoria in contesto pesa **~260 token per richiesta** (921 caratteri, tetto 3.600);
  un `/dream` costa **~2,5k token e ~8 s**, una volta per molte sessioni. **Senza memoria il costo fisso è zero**
  (prima richiesta 3.617 token con e senza l'estensione).
- **Token per compito +25%** (22,8k → 28,6k) e **tempo +10 s** (17 → 28 s): solo ~1,3k di questi sono la memoria; il
  resto è il lavoro in più che le regole richiedono (test `.spec.js` nuovi, JSDoc, messaggi in italiano).
- **Bilancio**: ogni violazione evitata nella realtà è una correzione dell'utente in meno (un turno da ~5–6k token più il
  tempo di rileggere e correggere): sui 5 compiti le 5 violazioni evitate valgono all'incirca quanto il costo in più, a
  pari token, con qualità piena e senza dover ripetere le stesse correzioni.
- **Due bug veri trovati dalla valutazione e corretti** (una password finita in memoria; una proposta scartata intera
  per un solo errore). Dopo la correzione: 0 segreti in memoria su 5, 5/5 consolidamenti riusciti.

## Metodo
- **Memoria a breve termine sintetica**: 8 sessioni in formato Pi (`eval/memory-sessions.mjs`) su lavori nella fixture
  `eval/fixture` in cui l'utente corregge Pi su 6 regole che il codice non permette di dedurre:

  | Regola | Contenuto |
  |---|---|
  | R1 | prezzi sempre in centesimi interi, mai float né euro |
  | R2 | commento JSDoc `/** */` sopra ogni funzione esportata nuova |
  | R3 | nessuna nuova dipendenza npm |
  | R4 | messaggi di errore in italiano |
  | R5 | mai modificare `src/csv.js` |
  | R6 | test nuovi in `test/<modulo>.spec.js` — **sostituisce** una regola più vecchia (`tests/`): deve vincere la recente |

  Più rumore: 2 sessioni irrilevanti, una chiave API e una password finte (non devono finire in memoria).
- **Bracci**: `none` (nessuna memoria) e `dream` (stesse sessioni consolidate da `/dream` con Haiku, approvazione
  automatica, poi compito con la memoria caricata). Memoria globale isolata (`PI_MEMORY_GLOBAL_PATH=""`).
- **Compiti** (`eval/memory-cases.mjs`), richieste nuove che invitano a violare le regole senza nominarle:

  | Compito | Richiesta |
  |---|---|
  | mt1 | funzione che calcola il prezzo medio degli articoli, con un test |
  | mt2 | funzione che applica l'IVA al 22% al prezzo di un articolo |
  | mt3 | ogni articolo aggiunto deve ricevere un identificativo univoco |
  | mt4 | il titolo di BK0057 viene letto male da `loadCatalog` (virgola tra virgolette) |
  | mt5 | `addItem` deve rifiutare prezzi negativi o non interi, con i test |

- **Giudice deterministico** per regola (rispettata / violata / non applicabile), verificato offline su 10 soluzioni di
  riferimento (5 corrette, 5 sbagliate): 10/10 giudicate correttamente. Rispetto = rispettate / (rispettate + violate).
- Comandi: `node eval/memory-run.mjs --arms none,dream --run memory-r2 --concurrency 2`, poi
  `node eval/memory-analyze.mjs memory-r2`. Risultati: `eval/results/memory-r1.jsonl`, `memory-r2.jsonl`.

## Risultati — giro definitivo (`memory-r2`, dopo le correzioni)

### Per braccio
| Braccio | Regole rispettate | Input medio/compito | Output medio/compito | Richieste/compito | Tempo medio/compito | Costo `/dream` |
|---|---|---|---|---|---|---|
| none | **10/15 (67%)** | 22,8k | 1,1k | 4,8 | 17,4 s | — |
| dream | **20/20 (100%)** | 28,6k | 1,3k | 5,2 | 27,8 s | 2,1k in + 0,44k out, 8,4 s |

### Per regola
| Regola | none | dream |
|---|---|---|
| R1 centesimi interi | 1/2 | 2/2 |
| R2 JSDoc | 0/2 | 2/2 |
| R3 nessuna dipendenza | 5/5 | 5/5 |
| R4 errori in italiano | 0/1 | 2/2 |
| R5 non toccare `src/csv.js` | 4/5 | 5/5 |
| R6 test in `.spec.js` | — (vedi nota) | 4/4 |

**Nota R6 (a favore di `none`)**: senza memoria Pi ha aggiunto i test nel vecchio `test/inventory.test.js` (4 compiti su
5) invece di creare `test/<modulo>.spec.js`; il giudice conta solo i file *nuovi*, quindi li considera "non
applicabili". Con un criterio rigoroso (test aggiunti nel file sbagliato = violazione) `none` scende a **10/19 (53%)**.
Il confronto principale è quindi prudente.

### Per compito
| Compito | none: violazioni | dream: violazioni | none in/out, tempo | dream in/out, tempo |
|---|---|---|---|---|
| mt1 prezzo medio | R1 float, R2 senza JSDoc | — | 24,0k / 1,1k, 19 s | 27,8k / 1,2k, 27 s |
| mt2 IVA 22% | R2 senza JSDoc | — | 24,8k / 0,9k, 17 s | 31,6k / 1,1k, 31 s |
| mt3 id univoco | — | — | 18,6k / 1,2k, 16 s | 31,9k / 1,9k, 31 s |
| mt4 BK0057 | R5 ha modificato `src/csv.js` | — | 16,2k / 1,0k, 12 s | 18,8k / 1,1k, 26 s |
| mt5 prezzi negativi | R4 errori in inglese | — | 30,3k / 1,1k, 23 s | 33,1k / 1,2k, 24 s |

### Qualità del consolidamento (5 esecuzioni di `/dream`)
| Controllo | Esito |
|---|---|
| `memory.md` creato | 5/5 |
| segreto finto finito in memoria | **0/5** |
| regola contraddetta: versione recente (`.spec.js`) presente, vecchia (`tests/`) assente | 5/5 |
| tutte e 6 le regole presenti in memoria | 5/5 |
| dimensione | 921 caratteri in media (~260 token), 6,8 voci; tetto 3.600 |

Esempio di memoria prodotta (mt2):
```
- [correzione] Messaggi di errore sempre in italiano: li leggono i librai in negozio.
- [preferenza] Nessuna dipendenza npm esterna: solo Node.js standard library.
- [correzione] Prezzi SEMPRE in centesimi interi: arrotonda con Math.round, mai float o euro.
- [preferenza] Test nuovi in test/<modulo>.spec.js, non in cartella tests/.
- [correzione] JSDoc /** ... */ obbligatorio per ogni funzione esportata nuova.
- [decisione] src/csv.js manutenuto dal team fornitore: non toccare mai, scrivi codice nuovo altrove.
- [preferenza] Per slug unici: usa solo node:crypto e la slugify in src/format.js.
- [fatto] paginate(items, page, size) restituisce elementi della pagina richiesta, pagine da 1.
```
(metadati `conferme · ultima` omessi qui)

## Token e tempo: da dove viene la differenza
| Voce | Valore |
|---|---|
| Prima richiesta, nessuna memoria (con e senza estensione) | 3.617 token — **costo fisso zero** |
| Memoria in contesto | ~260 token per richiesta (≈ 1,3k per compito da 5 richieste) |
| Resto dell'aumento per compito (+4,5k in, +0,2k out, +0,4 richieste) | lavoro richiesto dalle regole: file `.spec.js` nuovi, JSDoc, messaggi tradotti |
| `/dream` | ~2,5k token (Haiku), ~8 s, **una volta** per il gruppo di sessioni consolidate |
| Controllo "tutto in memoria" (sessioni grezze incollate, l'approccio ingenuo) | stimato ~1.000+ token per richiesta, cresce con le sessioni: ~4× la memoria consolidata, senza risolvere contraddizioni né filtrare segreti |
| Tempo per compito | +10 s, quasi tutto lavoro in più (test e documentazione) più la memoria letta |

Ammortamento: la memoria costa ~1,3k token per compito; una sola violazione evitata risparmia almeno un turno di
correzione (~5–6k token più il tempo dell'utente). Sotto questo carico il bilancio in token è circa in pari già con
**una violazione evitata ogni 4 compiti**; qui ne è stata evitata una per compito.

## Stress test: cosa succede quando la memoria cresce

### Buchi trovati nel codice e chiusi
| Buco | Rischio | Correzione |
|---|---|---|
| `memory.md` senza tetto proprio | ricordi "invisibili" (nel file ma non caricati) e prompt di `/dream` che cresce con il file | `enforceCap`: il tetto vale anche per il file; l'eccedenza meno importante va in archivio ("oltre il tetto della memoria"); `/dream` sa quanto è pieno e oltre il 70% unisce e sintetizza |
| Arretrato oltre il limite di lettura (~16k token) | le sessioni più vecchie tagliate ma segnate come consolidate: perse in silenzio | `lookbackBatch`: dalla più vecchia, a blocchi; si segna consolidato solo ciò che è stato letto e `/dream` dice "restano N sessioni" |
| Quasi-duplicati | la stessa regola in due formulazioni ("commit in inglese" / "…in inglese, non italiano") | se il nuovo testo contiene il vecchio, lo **sostituisce** (il vecchio va in archivio, conferme +1); se è contenuto, **rinforza**. Così "commit in italiano" → "in inglese, non più in italiano" è un aggiornamento, non un rinforzo |
| Metadati copiati dal modello nel testo | "… (c 1, ultima 2026-10-24)" dentro il ricordo | ripuliti nel parsing della proposta |

### Prova offline (nessun modello, costo zero) — `extensions/memory-growth.test.ts`
- **Un anno simulato**: 365 consolidamenti, 1–3 ricordi nuovi al giorno e rinforzi: memoria sempre ≤ tetto, contesto
  ≤ tetto, prompt di `/dream` limitato (memoria al tetto + un blocco di lettura), oltre 300 ricordi archiviati e non persi,
  i ricordi rinforzati presto sopravvivono.
- **Arretrato di 40 sessioni** con blocchi da 20k caratteri: consolidato in più blocchi, dalla più vecchia, **ogni
  messaggio letto esattamente una volta**.
- Tetto, priorità (📌 e correzioni restano), quasi-duplicati, contraddizioni, metadati: 6 test. Estensioni 65/65.

### Prova empirica con il modello vero — `eval/memory-stress.mjs` (run `memory-stress-r2`)
Le 8 sessioni di base (le 6 regole), poi 5 ondate da 8 sessioni: 16 preferenze nuove per ondata (abbastanza da sforare il
tetto), 3 regole cambiate nel tempo (lingua dei commit, formato date, limite di righe), rinforzi delle regole base, un
token finto `ghp_…` nell'ondata 3. Dopo ogni ondata un `/dream` reale (Haiku, approvazione automatica).

| Ondata | Sessioni | `/dream` tempo | `/dream` token (in+out) | Voci | Contesto | Archivio | Regole base | Regole cambiate (versione nuova, vecchia assente) | Segreto |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 8 | 7,2 s | 2,1k + 0,3k | 6 | ~141 tok | 0 | 6/6 | — | no |
| 1 | 16 | 8,8 s | 2,8k + 0,7k | 23 | ~388 tok | 0 | 6/6 | — | no |
| 2 | 24 | 9,2 s | 3,4k + 0,7k | 40 | ~613 tok | 1 | 6/6 | 1/1 | no |
| 3 | 32 | 10,4 s | 4,2k + 0,8k | 57 | ~861 tok | 2 | 6/6 | 2/2 | no |
| 4 | 40 | 18,3 s | 4,8k + 1,8k | 50 | ~757 tok | 19 | 6/6 | 3/3 | no |
| 5 | 48 | 15,3 s | 4,5k + 1,7k | 50 | ~899 tok | 51 | 6/6 | 3/3 | no |

- **Il costo per richiesta resta sotto il tetto** (al massimo ~900 token) anche con 48 sessioni e oltre 100 preferenze
  proposte: la memoria si stabilizza intorno a 50 voci e il resto finisce in archivio.
- **Il costo di `/dream` cresce ma si ferma**: da ~2,4k a ~6,5k token e da 7 a ~16–18 s, limitato da memoria al tetto
  più un blocco di lettura.
- **Le regole importanti non si perdono mai** (6/6 in ogni ondata) e si **rinforzano** (fino a 6 conferme).
- **Le regole che cambiano vengono aggiornate** (3/3), con la versione vecchia in archivio.
- **Nessun segreto** in memoria o in archivio.

Primo tentativo (`memory-stress-r1`) scartato come misura: errori del generatore (ondate datate prima delle sessioni di
base, quindi ignorate; il cambio del formato date mai inviato). Ha comunque mostrato i quasi-duplicati e i metadati
copiati, poi corretti.

**Limiti residui**: il modello a volte crea una voce riassuntiva che ripete regole già presenti singolarmente
(ridondanza leggera, dentro il tetto); le preferenze sintetiche dello stress test sono più ripetitive di quelle reali.

## Primo giro (`memory-r1`): bug trovati
| | none | dream |
|---|---|---|
| Regole rispettate | 11/15 (73%) | 18/19 (95%) |

- **Segreto in memoria (1/5)**: la password scritta a parole ("la password del gestionale è …") superava il
  mascheramento, che riconosceva solo `password=…`, e il modello l'ha copiata in un ricordo. Corretto con due difese:
  mascheramento anche della forma discorsiva + scarto di ogni ricordo proposto che parla di credenziali.
- **Consolidamento perso (1/5)**: un id inesistente nella proposta del modello faceva scartare l'intera proposta.
  Ora si scarta la sola voce non valida (segnalata) e si applica il resto.
- **Misura**: il costo di `/dream` risultava 0 perché la chiamata a Haiku non passa dalla sessione; ora si legge da
  `.pi/dream-last.json`.
Commit della correzione: `fix: keep credentials out of memory and skip only invalid proposal items`.

## Limiti
- **Campione piccolo**: 5 compiti × 1 giro per braccio (10 test), 6 regole. Il segnale è netto e coerente (0 violazioni
  con memoria contro 5 senza), ma non è una stima statistica precisa.
- **Sessioni sintetiche** con correzioni esplicite; nelle sessioni reali le correzioni sono più sparse e implicite.
- **Rinforzo non osservato**: al primo consolidamento tutte le voci hanno "conferme: 1", anche le regole ripetute in più
  sessioni; il rinforzo scatta solo nei consolidamenti successivi.
- **Rumore in memoria**: 1–2 voci su 8 sono dettagli di un singolo compito (es. `paginate`), che il prompt chiede di
  escludere; costano poco ma occupano spazio.
- **Non misurati**: oblio nel tempo, `/ricorda` sull'archivio, approvazione voce per voce in TUI, memoria globale,
  sessioni lunghe reali. Con memoria presente il pre-avvio del bridge non viene riusato (la firma non include la memoria):
  un avvio a freddo alla prima richiesta.

## Conclusione
`/dream` mantiene ciò che promette il video — Pi smette di ripetere errori già corretti — con un costo piccolo e
prevedibile: zero senza memoria, ~260 token per richiesta con memoria, ~2,5k token per consolidamento. È
**accettato** secondo i criteri della spec, con tre migliorie consigliate: filtro più severo sui dettagli dei singoli
compiti, riuso del pre-avvio con la memoria nella firma, e una misura su sessioni reali.

## Memoria profonda a richiamo vs memoria con tetto — 2026-10-06

Design: `docs/specs/2026-10-06-deep-memory-design.md`. Archivio senza tetto (`.pi/memory/memories.jsonl` + embedding),
richiamo locale a ogni richiesta (embedding multilingue `paraphrase-multilingual-MiniLM-L12-v2` q8 + BM25 + entità +
forza), al massimo 5 ricordi ≤ 300 token in coda alla richiesta, nulla sotto soglia. `PI_MEMORY_MODE=capped|deep`.

**Prova** (`memory-run.mjs --arms capped,deep --tasks mt1,mt2,mt4,mt5,mt9 --bury 3`, run `memory-deep-r4`): le 6
regole sepolte sotto 24 sessioni di rumore (~48 preferenze minori), consolidamento reale con Haiku, 4 compiti
pertinenti + 1 domanda estranea (mt9), 10 test.

| | capped (con tetto) | deep (a richiamo) | none (giro `memory-r2`) |
|---|---|---|---|
| Regole rispettate | 15/17 (88%) | 15/18 (83%) | 10/15 (67%) |
| Memoria iniettata per richiesta | 271–910 token, sempre | **44–100 token** | 0 |
| Input medio per compito | 29,1k | **21,4k** | 22,8k |
| Domanda estranea mt9 | 857 token iniettati | 44 token (1 ricordo) | — |
| `/dream` (in+out per esecuzione) | 6,2k + 1,8k | 6,3k + 2,3k | — |
| Esecuzioni di `/dream` per caso / risposte vuote | 1 / 0 | 1 / 0 | — |

**Lettura**
- La memoria profonda dà **quasi la stessa qualità** della memoria con tetto (83% contro 88%: una violazione di
  differenza, dentro il rumore di 5 compiti) e molto più della nessuna memoria (67%), **con ~1/9 dei token di memoria
  per richiesta** e un costo per compito pari a quello senza memoria (21,4k contro 22,8k): i vantaggi della memoria
  quasi gratis.
- È completa: nessun ricordo scartato per spazio, il resto resta nell'archivio e viene richiamato quando serve.
- Ancora da migliorare: sulla domanda estranea ha iniettato 1 ricordo (44 token, criterio "zero" mancato di poco:
  soglia da alzare leggermente); le regole di stile "trasversali" (JSDoc R2, errori in italiano R4) non sempre emergono
  da richieste che non le nominano — andrebbero trattate come regole sempre valide per i compiti che scrivono codice.

**Benchmark offline del richiamo** (agente, `pi-memory/bench/recall-bench.ts`, 1.000 ricordi): recall@5 1,00 con parole
in comune, 0,70 sulle parafrasi pure (0,85 complessivo), 0/20 falsi positivi sulle estranee, media 59 token iniettati,
1 ms per richiamo dopo il caricamento del modello (~1,7 s, in background dopo l'avvio). Prima richiesta senza memoria
identica con e senza l'estensione (3.519 token).

**Costi locali**: modello 118 MB in `~/.cache/pi-memory/models`; `pi-memory/node_modules` 888 MB (onnxruntime). Nessun
effetto su token o avvio, ma pesa sul disco.

**Bug trovati dai giri falliti (`memory-deep-r1`–`r3`) e corretti**
- Con la memoria vuota il modello "univa" cose dette nelle sessioni inventando id: ogni voce veniva scartata e le
  sessioni risultavano consolidate lo stesso (memoria persa in silenzio). Ora unioni/aggiornamenti con id inesistenti
  diventano aggiunte, il prompt dice quali id esistono, e una risposta vuota o tutta scartata non fa avanzare lo stato
  (la risposta grezza resta in `.pi/dream-proposal.md`).
- Prima della correzione fino a 8 tentativi su 8 fallivano in alcuni casi; dopo: 1 esecuzione, 0 fallimenti su 10.
