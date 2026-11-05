# A/B delle leve per il −30% (2026-11-04)

Banco: `eval/ab/run.mjs <A|B> <rep> haiku [short|long]`. Stessi prompt, Pi vero in RPC (`PiHarness`, sessione salvata), modello haiku.
- **A** = default di Pi: `keepRecentTokens` 20000, archivio spento (`PI_ARCHIVE=0`).
- **B** = leve: `keepRecentTokens` 5000 (settings di progetto in `.pi/settings.json`) + archivio `richiama` con recupero automatico.
Costo = Σ pesata dell'uso di ogni richiesta letto dal file di sessione, riassunto di compattazione incluso (input 1, cacheRead 0,1, cacheWrite 1,25, output 5).
Qualità = 5 domande a risposta nota fatte dopo la compattazione (segreto e porta piantati al primo turno; tre costanti lette dai file all'inizio).

| scenario | braccio | costo totale | compattazioni | costo dopo la compattazione | risposte giuste |
|---|---|---|---|---|---|
| short (compattazione forzata, 7 letture) | A | 211.675 | 1 | 39.531 | 5/5 (4/5 in `result-short-A-1.json`: errore dell'atteso `15_000`, la risposta `15000` è giusta) |
| short | B | 217.134 | 1 | 54.776 | 5/5 |
| long (21 letture grosse + 3 di lavoro, compattazione automatica) | A | 824.260 | 2 | 51.075 | 5/5 |
| long | B | 851.185 | 2 | 57.275 | 5/5 |

## Esito
**Le leve 1 + archivio non risparmiano: B costa +2,6% (short) e +3,3% (long) rispetto ad A.** Qualità pari: 5/5 in tutti i casi, anche senza `richiama` (le costanti stavano nel riassunto o sono state rilette con `bash`).
Il −9…−10% della leva 1 (simulato in `40-piano-30.md`) **non è confermato** in questo scenario. Il −30% non è raggiunto.

## Limiti
- Una sola ripetizione per braccio: la differenza (+3%) è nel rumore tra giri freddi e caldi, non va letta come peggioramento certo.
- Scenario di sole letture di file: dopo la compattazione il contesto è dominato da prompt fisso + riassunto, quindi `keepRecentTokens` pesa poco. Il caso reale (modifiche, test, errori in coda) non è coperto.
- Haiku, non il modello di lavoro. Le leve 3 (tetto alla fonte), 4 (riassunto sul prefisso in cache) e 5 (prompt più corto) non sono nel braccio B: non implementate.
- Le leve non sono state provate nel TUI.

## Conseguenza
Il piano `40-piano-30.md` non regge con le sole leve 1 e archivio. Restano da misurare 3, 4, 5 (più la 2, già applicata), ognuna con questo banco, prima di dire che il 30% è raggiungibile.

## Ripetizione (scenario long, 3 run per A e B, 2 per C)
Braccio C aggiunto: solo `keepRecentTokens` 5000, archivio spento, per separare le due leve.

| braccio | costo totale (run) | media | rispetto ad A |
|---|---|---|---|
| A default | 824.260 · 815.550 · 810.380 | 816.730 | — |
| C solo keepRecent 5000 | 809.749 · 819.697 | 814.723 | −0,2% |
| B keepRecent 5000 + archivio | 851.185 · 846.973 · 846.004 | 848.054 | **+3,8%** |

Qualità: 5/5 in tutti gli 8 run long.
Token medi per run (A → B): cacheWrite 373.008 → 388.552 (+4,2%), cacheRead 2.968.629 → 3.028.956 (+2,0%), output 2.816 → 2.946 (+4,6%).

### Letture
- **Il +3,8% di B è stabile** (tre run tra +3,2% e +4,5%): non è rumore. Viene dall'archivio, non da `keepRecentTokens`: C è uguale ad A (−0,2%, due run, dentro la variazione tra run di circa ±1%).
- **`keepRecentTokens` 5000 non risparmia** in questo scenario: il −9…−10% simulato non si ripete.
- **Causa del costo dell'archivio: non dimostrata.** Ipotesi coerente col dato (più cacheWrite): `richiama` si accende dopo la prima compattazione e cambia l'elenco dei tool a metà sessione, quindi la cache del prefisso si ricostruisce; più il messaggio di recupero automatico. Va verificato con un braccio in cui `richiama` è acceso dall'inizio.
- Con un'unica forma di carico (letture) e haiku, il risultato vale per questo scenario; l'archivio serve alla qualità su sessioni lunghe, non al costo.

## Banco "dump": dati che esistono solo nella conversazione (2026-11-04)
Obiettivo reale: a pari uso di token, un contesto secondario che allarga il contesto. Il banco long misurava solo il costo e le domande erano rileggibili da disco (A e B 5/5): non discriminava.

Carico: 12 output di `cat` (50 righe `Ln = codice esadecimale casuale` ciascuno) letti nella sessione, poi i file vengono **cancellati**; 21 letture di file e 3 compiti (2 compattazioni); 6 domande «nel file bNN.txt che ti avevo fatto leggere con cat, quanto valeva Ln?». Il dato non si può rileggere né indovinare. Modello haiku, 3 run per braccio.

| braccio | costo totale (run) | media | corrette su 18 |
|---|---|---|---|
| A default Pi | 1.021.952 · 1.122.438 · 985.450 | 1.043.280 | **1** |
| B keepRecentTokens 5000 + archivio | 847.961 · 893.610 · 870.468 | 870.680 | **18** |

- **Qualità:** A perde quasi tutto (la compattazione non conserva i valori e il modello non può rileggerli); B li recupera tutti.
- **Costo:** B costa il **16,5% in meno** di A. Il motivo non è la leva: A spende molti giri di `bash` a cercare file che non esistono (costo delle 6 domande: A 195–323k, B 55–78k).
- Il risultato vale per questo carico (dati non rileggibili da disco). Sul carico solo letture (banco long) l'archivio costa +3,8% senza guadagno di qualità.

### Cosa ho dovuto correggere in `extensions/archivio.ts` perché B funzionasse
Prima delle correzioni B faceva 0/6 come A: il recupero automatico non scattava e il modello non chiamava `richiama`.
1. Un risultato di tool nell'archivio non diceva da quale comando veniva: ora ogni suo chunk inizia con gli argomenti della chiamata (`<{"command":"cat …/b02.txt"}>`), quindi si trova per nome file.
2. Il recupero automatico richiedeva il 40% dei termini della domanda: le parole di riempimento («quanto», «solo», «file») lo impedivano. Ora, se la domanda contiene ≥2 identificatori presenti nell'archivio (termini con cifre: `b02`, `L33`, `48213`), il chunk deve contenerli tutti; altrimenti vale la regola precedente.
Test: `extensions/archivio.test.ts` (6 test verdi), suite estensioni verde.

### Limiti
- Il recupero automatico per identificatori copre domande con ≥2 codici; negli altri casi serve che il modello chiami `richiama` (haiku non l'ha mai chiamato di sua iniziativa).
- Dopo la modifica del recupero non ho rieseguito i banchi short/long.
- Prova nel TUI reale: da fare dall'utente.

## Controlli della fase 4 (2026-11-04, studio `contesto-secondario-recupero`)

### 1. Costo del braccio `richiama` (long, haiku, 3 run, token pesati)
| Braccio | Media | Δ vs A | Corrette |
|---|---|---|---|
| A default Pi | 816.730 | — | 5/5 ×3 |
| C keepRecent 5000, niente archivio | 814.723 (2 run) | −0,2% | 5/5 ×2 |
| B archivio + auto-recall | 848.054 | +3,8% | 5/5 ×3 |
| D come B, `richiama` acceso dall'inizio | 845.141 | +3,5% | 5/5 ×3 |
| E solo `richiama`, auto-recall spento | 837.070 | +2,5% | 5,5,3 |

Lettura: accendere il tool dall'inizio (D) non toglie il costo: la riscrittura della cache non è la causa del +3,8%. Il tool da solo costa +2,5% (E), l'auto-recall altro ~+1,3%. Causa del +2,5% non dimostrata. E ha una run 3/5: senza auto-recall haiku non ha richiamato.

### 2. Sonnet su `dump` (1 run per braccio)
A: 852.921, corrette 0/6. B: 884.989 (+3,8%), corrette 6/6. Le iniezioni automatiche erano 22; `richiama` non è mai stato chiamato dal modello (0 chiamate). Anche Sonnet non lo usa da solo: C (mappa nel riassunto) non ha prova a favore.

### 3. Retrieval senza identificatori (50 domande parafrasate da haiku su 2 sessioni vere, 1874 e 1170 chunk)
Verità = chunk della stessa voce (rigida) e giudizio di rilevanza di haiku sull'unione dei top-3 (poolato).
| Metodo | recall@3 rigido | recall@10 | hit@1 poolato | hit@3 poolato | ms/query |
|---|---|---|---|---|---|
| BM25 attuale | 0,16 | 0,22 | 0,28 | 0,52 | 64 |
| BM25 + prefisso 5 car. | 0,18 | 0,26 | 0,30 | 0,54 | 37 |
| e5 coseno | 0,18 | 0,32 | 0,34 | 0,42 | 23 |
| RRF(BM25, e5) | 0,16 | 0,28 | 0,40 | 0,52 | 87 |
| RRF(stem, e5) | 0,18 | 0,30 | 0,40 | 0,52 | 60 |
Costo di indicizzazione: embedding di 1874 chunk in 411 s (con CPU carica, load ~20): fuori dal vincolo di latenza se fatto in linea, serve il background.
Limiti: domande e giudice sono LLM (haiku); 50 domande; 2 sessioni; chunk da 900 car. con molti vicini sullo stesso tema.

### 4. Dimensione dei chunk (BM25, stesse 50 domande, verità = voce di origine; `eval/archivio/chunk-size.mjs`)
| Chunk (car.) | N. chunk | hit@1 | hit@3 | Car. restituiti (top-3) |
|---|---|---|---|---|
| 200 | 9880 | 0,08 | 0,12 | 645 |
| 300 | 7005 | 0,08 | 0,14 | 971 |
| 450 | 5030 | 0,12 | 0,16 | 1385 |
| 900 (oggi) | 3155 | 0,10 | 0,16 | 2611 |
| 1800 | 2414 | 0,06 | 0,16 | 4340 |
| 4000 | 2065 | 0,06 | 0,14 | 5777 |
| voce intera (20000) | 1948 | 0,06 | 0,14 | 6063 |
Con k=6: 450 → 0,20 (2792 car.); 900 → 0,20 (5138 car.).
Lettura: la dimensione del chunk non sposta il recupero (0,12–0,16 hit@3 con la metrica rigida). Chunk da 450 dà lo stesso hit@3 di 900 con ~47% di testo in meno restituito: il guadagno è di costo dell'estratto, non di qualità. Limiti: solo BM25 (non e5), metrica rigida sulla voce di origine (sottostima: chunk vicini sullo stesso tema contano come errori; il giudizio poolato del §3 dà ~0,5), nessun giudice rieseguito per dimensione.

### 5. Riformulazione della query con LLM (`eval/archivio/rewrite-bench.mjs`; stesse 50 domande, giudice poolato rieseguito)
Haiku scrive 3 query per parole chiave per domanda; RRF k=60 su domanda + 3 riscritture (BM25, oppure BM25 + e5).
| Metodo | hit@1 | hit@3 | precision@3 |
|---|---|---|---|
| BM25 attuale | 0,24 | 0,48 | 0,27 |
| BM25 + prefisso | 0,30 | 0,52 | 0,33 |
| e5 | 0,34 | 0,46 | 0,29 |
| RRF(BM25, e5) | 0,36 | 0,50 | 0,31 |
| riscritture, BM25, 4 query | 0,50 | 0,64 | 0,42 |
| riscritture, BM25, solo 3 riscritture | 0,46 | 0,74 | 0,41 |
| **riscritture, BM25 + e5, 4 query** | **0,52** | **0,78** | **0,52** |
Rumore del giudice: gli stessi metodi di §3 si spostano di ±0,04 tra due giudizi. Il salto (+0,26–0,28 su hit@3) è molto oltre.
Costo non misurato nel banco: una chiamata a un modello piccolo per ricerca (~300 token in/out) più l'embedding delle 4 query (~25 ms ciascuna con indice già pronto). Limiti: 50 domande sintetiche, giudice haiku, stesse 2 sessioni.

### 6. Costo reale della riscrittura (`eval/archivio/rewrite-cost.mjs`, haiku via `claude -p`, pesi 1 / 0,1 / 1,25 / 5)
| Variante | Input | cacheRead | cacheWrite | Output | Pesato per chiamata |
|---|---|---|---|---|---|
| `claude -p` di default (n=8, cwd `/tmp`) | 2 | 118.827 | 34.508 | 522 | 57.630 |
| `claude -p` con i flag del bridge e prompt minimo (n=6) | 2 | 0 | 736 | 229 | **2.066** |
Riferimento: una richiesta media del banco long (braccio A) pesa 14.850. Una riscrittura con i flag giusti costa quindi ~14% di un giro; senza i flag, ~3,9 giri. I flag: `--system-prompt` corto, `--setting-sources ""`, `--disable-slash-commands`, `--strict-mcp-config`, `--no-session-persistence`, `--tools ""`.
Il costo è dominato dall'output (229 token × 5 = 1.145). Latenza ~15 s per chiamata (misurata sopra, PC carico): incompatibile con il vincolo di 50 ms; la riscrittura non può stare nel percorso dell'iniezione automatica sincrona.
Non misurato: costo totale in una sessione (numero di ricerche), effetto sulla quota reale dell'abbonamento, riscrittura fatta da Sonnet dentro `richiama` (costo zero extra ma il modello non chiama il tool).

### 7. Domande vere (`eval/archivio/real-questions.mjs`, `real-rank.mjs`; giudice sonnet, riscrittore haiku)
24 messaggi veri dell'utente, presi da 3 sessioni con ≥5 compattazioni, senza identificatori (percorsi, numeri, camelCase, backtick), scelti da haiku come «chiede di ritrovare un dettaglio detto prima». Archivio = voci prima di quel messaggio.
| Metodo | hit@1 | hit@3 | precision@3 |
|---|---|---|---|
| BM25 | 0,38 | 0,79 | 0,42 |
| BM25 + e5 (RRF) | 0,50 | 0,75 | 0,46 |
| riscritture + BM25 + e5 | 0,46 | 0,79 | 0,50 |
Sulle domande vere la riscrittura non aiuta (0,79 = 0,79): i messaggi reali portano già parole del testo vecchio (diversamente dalle 50 domande parafrasate di §5). Quindi il +0,28 di §5 vale per domande sintetiche. Limiti: n=24, pochi sono vere richieste di recupero (molti sono comandi come «committa…»), il giudice conta «rilevante» non «risposta corretta», nessuna misura end-to-end con Pi.

### 8. Iniezioni automatiche sbagliate e costo (banco long)
Nel braccio B tutte le 20 iniezioni automatiche per run erano inutili: 15 su 20 ripetevano un vecchio comando «Leggi il file X» quasi uguale al prompt. Filtro `repeatedCommand` in `extensions/archivio.ts` (messaggio utente vecchio, corto, che condivide ≥50% dei termini): iniezioni 20 → 5 per run (test `archivio.test.ts` 7/7). Costo B con filtro (3 run): 860.571 / 812.574 / 826.158, media **833.101** contro A 816.730 (**+2,0%**, prima +3,8%), contro B senza filtro 848.054. Corrette 5, 4, 5 (un errore nel run 5). Varianza tra run ~±3%: ancora non ≤ default. Le 5 iniezioni residue sono corrette (porta/codice Zefiro) o ripetono lettura di file già letti (tool result del file stesso, non necessarie).

### 9. End-to-end senza identificatori, ≥5 compattazioni (modo `noid` di `eval/ab/run.mjs`, haiku, 3 run per braccio)
Scenario: 12 rapporti (file con 14 righe di rumore e una riga di fatto, valori casuali) letti con `cat`, poi 24 letture di file grandi con `reserveTokens` 150000 (9–10 compattazioni per run), file cancellati, 6 domande con **sinonimi e senza nomi di file né identificatori** («muletto elettrico … chilometri» → «carrello elevatore elettrico … quanta strada»). Entrambi i bracci con `keepRecentTokens` 10000. Punteggio rigoroso: valore giusto e risposta che non dichiara «non trovato» (il conteggio per sola sottostringa dava falsi positivi).
| Braccio | Corrette (rigoroso) | Corrette (sottostringa) | Costo medio pesato |
|---|---|---|---|
| A default Pi | 13/18 (72%) | 15/18 | 1.082.444 |
| B archivio + recupero automatico | **5/18 (28%)** | 12/18 | 1.123.754 (+3,8%) |
**Nessun braccio arriva al 90%; B è peggio di A.** In B il modello non ha mai chiamato `richiama` (0 chiamate in 3 run) e il recupero automatico è scattato 2 volte per run: la soglia lessicale (≥4 termini, 40%) non passa con domande parafrasate; il modello ha cercato in `debug.log` e nelle fonti `nb`. In A le risposte giuste vengono dal riassunto di compattazione (la qualità dipende da cosa il riassunto ha tenuto: run 1 2/6, run 2 6/6).
Retrieval offline sulle stesse sessioni B (`eval/archivio/noid-retrieval.mjs`, `noid-e5.mjs`; il pezzo con il fatto è nei primi k?):
| Metodo | hit@1 | hit@3 |
|---|---|---|
| BM25 (quello usato dall'archivio) | 6/18 | 6/18 |
| BM25 top-30 riordinato da e5 | 8/18 | 8/18 |
| **e5 su tutto l'archivio (sessione B1: 614 chunk)** | **5/6** | **6/6** |
| RRF(BM25, e5) (B1) | 3/6 | 6/6 |
Quindi il collo di bottiglia non è il recupero ma l'**innesco**: con e5 su tutto l'archivio il pezzo giusto è nei primi 3 in 6/6 casi senza alcuna parola in comune; il recupero automatico attuale, lessicale, non lo trova e il modello non chiama il tool. Limiti: 1 sessione per l'e5 completo, domande sintetiche (6 per run), haiku.

### 10. Correzione al banco: impostazioni di progetto ignorate
Le impostazioni in `<cwd>/.pi/settings.json` dei bracci A/B/C (§ precedenti) **non venivano applicate**: Pi ignora le impostazioni di progetto non fidate quando non c'è interfaccia (`--approve` assente). I bracci differivano quindi solo per l'archivio, non per `keepRecentTokens`; vale `~/.pi/agent/settings.json` (`reserveTokens` 80000, `keepRecentTokens` 10000) per tutti. Spiega C ≈ A (−0,2%). Il modo `noid` passa `--approve`. I risultati su archivio (long, hard, dump) restano validi come confronto A (archivio spento) contro B; i numeri sulla leva `keepRecentTokens` per braccio no.

### 11. Recupero automatico semantico (D': e5 in background + z-score), modo `noid`, haiku, 3 run
Codice: `extensions/archivio.ts` (`semanticRecall`, `repeatsPrompt`, indice dei vettori costruito in background con `WorkerEmbedder` dopo `session_start`/`session_compact`; ripiega sul lessicale se l'embedder non è pronto; `PI_ARCHIVE_SEM=0` lo spegne). Soglia: e5 dà punteggi 0,80–0,88 a testi non correlati, quindi un coseno fisso non separa; si usa quanto il chunk spicca sul resto dell'archivio (z-score ≥3,5, `eval/archivio/noid-calibrate.mjs`: richieste di dati z 2,8–6,2, prompt ordinari 2,5–3,3, ripetizioni di «Leggi con read» 4,3–4,7 — queste ultime scartate da `repeatsPrompt`). Con 3,5 si perdono le richieste con z <3,5 (2 su 6 nella calibrazione) → soglia prudente per le iniezioni sbagliate, non per il richiamo.
| Braccio | Corrette (rigoroso) | Costo medio pesato |
|---|---|---|
| A default Pi | 13/18 (72%) | 1.082.444 |
| B lessicale (§9) | 5/18 (28%) | 1.123.754 |
| **B semantico** | **14/18 (78%)** | 1.016.715 (−6% su A, entro il rumore ±3–5%) |
Risposte quasi tutte senza tool (`[]`): le iniezioni sono servite (4/run). I 4 errori: 2 sull'item «forno» (la fonte dice «caldaia»: il modello riporta il dato giusto ma dichiara «non trovo» → il punteggio rigoroso lo scarta; per sottostringa 16/18 = 89%), 1 risposta vuota dopo `bash`, 1 caso in cui il valore c'è ma con nota (conta come errore per il filtro «non ho»). **Non raggiunge il 90% (78% rigoroso, 89% indulgente); n=18, un solo modello, domande sintetiche.** Iniezioni sbagliate non misurate (nessun prompt negativo nel banco): ancora aperto. Latenza: query e5 ~25 ms misurati in precedenza fuori dal main thread, non misurata nel turno.

### 12. Banco `noid` allargato (12 domande per run, forno/caldaia corretto, 8 prompt ordinari «neg»), haiku, 3 run per configurazione
Cambi al banco: tutte e 12 le domande (prima 6), item «caldaia» coerente con la fonte, 8 prompt che non richiedono nulla dal passato dopo le domande (ogni recupero agganciato a questi è un'iniezione sbagliata), `eval/ab/score-noid.py` (punteggio rigoroso, indulgente, iniezioni sbagliate, costo). Il recupero arriva subito dopo il messaggio utente a cui si riferisce.
| Configurazione | Corrette rigoroso | Iniezioni sbagliate (neg) | Costo medio |
|---|---|---|---|
| A default Pi | 23/36 (64%) | 0/24 | 1.147.538 |
| B semantico z≥3,5 | 34/36 (94%) | 10/24 (42%) | 1.172.713 |
| B semantico z≥3,7 | 36/36 (100%) | 6/24 (25%) | 1.156.504 |
| B z≥3,7 + penalità di «hubness» | 22/36 (61%) | 12/24 (50%) | 1.271.851 |
| B z≥3,7 + una voce non iniettata due volte, 3 varianti (dedup 1–3, uguali salvo marcare anche il lessicale e dedup per voce) | 35/36, 36/36, 30/36 | 6/24, 6/24, 4/24 | 1.153.434 / 1.114.923 / 1.139.903 |
Lettura: **corrette ≥90% in 4 serie su 5 con z≥3,7 (100%, 97%, 100%, 83%)**; il recupero lessicale vecchio era 28%, A 64% rigoroso (94% indulgente: A risponde dal riassunto ma spesso dichiara «non trovato»). **Iniezioni sbagliate 17–25%: il limite ≤10% NON è raggiunto.** Causa: un pezzo «hub» (lettura di `extensions/caveman.ts`, prosa generica sullo stile) è vicino a ogni domanda generica; correggere con la hubness (sottrarre la similarità media ai vicini) ha peggiorato (porta in alto i chunk corti «ok», «letto»; calibrato offline ma instabile online, dove l'indice si riempie a poco a poco). Dedup per voce porta le sbagliate a 4/24 nell'ultima serie ma fa perdere richiami (83%: le domande con z<3,7 restano senza innesco). La varianza tra serie identiche è alta (83–100%): n=36 per serie, un solo modello. Costo: B è tra −3% e +2% su A, dentro il rumore. Latenza nel turno: embedding della domanda nel worker, non misurata nel turno.
Test: `node --test --test-concurrency=2 extensions/*.test.ts` 302/302; `tsc --noEmit -p pi-ui` pulito; `extensions/archivio.test.ts` 9/9.

### 13. Soglia z≥4,2 (con deduplica per voce), stesso banco §12, haiku, 3 run
| Configurazione | Corrette rigoroso | Iniezioni sbagliate (neg) | Costo medio |
|---|---|---|---|
| A default Pi | 23/36 (64%) | 0/24 | 1.147.538 |
| B semantico z≥4,2 | **36/36 (100%)**, 12/12 in ogni run | **3/24 (12,5%)** | 1.151.844 (+0,4%, dentro il rumore) |
Le 3 iniezioni sbagliate sono sempre la stessa: la prima domanda ordinaria di ogni run («Scrivi in una riga cosa fa un algoritmo di ordinamento a bolle») riceve un pezzo di `extensions/caveman.ts` (prosa generica sullo stile); la deduplica per voce lo impedisce dopo la prima volta. Quindi 1 per run su 8 prompt = 12,5%, **non ≤10%** ma vicino; il numero dipende da quanti prompt ordinari seguono (una sessione vera ne ha molti di più dopo ogni richiamo vero: la stima va ripetuta su sessioni vere). Rispetto a z≥3,7 (4–6/24) le richieste vere non sono state perse in nessuna delle 3 run. Limiti: n=36 per serie, un solo modello (haiku), una sola serie a z≥4,2 (la varianza tra serie uguali in §12 era 83–100%), domande sintetiche. Latenza nel turno non misurata. Soglia adottata: 4,2 (`PI_ARCHIVE_SEM_Z`).

### 14. Latenza del recupero semantico nel turno (`eval/archivio/latency.mjs`)
Archivio di una sessione noid (670 chunk, 639 vettori), worker e5 già caldo, 60 richieste (3 domande × 20). Tempo aggiunto al turno = embedding della domanda + punteggio su tutto l'indice.
- Embedding della domanda: mediana 27,5 ms, p95 43,4 ms, max 47,9 ms.
- Punteggio (`semanticRecall`): mediana 1,1 ms, p95 8,7 ms, max 83,9 ms.
- Totale: mediana ≈29 ms, p95 ≈50 ms. Il limite ≤50 ms vale a mediana e al limite al p95; un picco di 84 ms nel punteggio (probabile pausa del garbage collector) fa superare i 50 ms in rari casi.
Limiti: una sola macchina (WSL2), senza altro carico durante la misura; non include il primo turno dopo l'avvio o dopo lo scarico del modello (10 min di inattività: in quel caso si ripiega sul recupero lessicale finché il worker non è pronto, tempo di caricamento non misurato); indice più grande = punteggio più lento (lineare nei chunk).

### 15. Carico di sole letture (`long`) col codice nuovo, haiku, 3 run per braccio (rep 11–13)
Codice: recupero semantico z≥4,2 con deduplica per voce, impostazioni di progetto applicate. 2 compattazioni per run, 5 domande sulla storia.
| Braccio | Costo pesato per run | Media | Corrette |
|---|---|---|---|
| A default Pi | 825.726 / 828.198 / 823.469 | 825.798 | 15/15 |
| B archivio | 836.552 / 846.386 / 837.782 | 840.240 | 15/15 |
B costa **+1,7%** su A (14.442 pesati), con A fermo a ±0,3% tra le run e B a ±1,2%: la differenza è sopra il rumore di questo banco. Su questo carico (dati rileggibili dal disco) l'archivio non fa guadagnare risposte (entrambi 15/15) e costa di più: il vincolo «costo ≤ default sul carico di sole letture» **non è rispettato**. La causa non è indagata (ipotesi, non verificate: definizione del tool `richiama` dopo la prima compattazione, iniezioni dei richiami, prefisso di prompt cambiato che invalida la cache). Sul carico con dati non rileggibili (`dump`, §10 dati validi) B costava −16,5% e rispondeva 18/18 contro 1/18; sul `noid` B costa +0,4% (§13).

### 16. Causa del +1,7% sul carico di sole letture (analisi delle 6 sessioni §15, token reali per richiesta)
Per run (media delle 3), messaggi dell'assistente: A pesato 785.503, B 799.430 (+13.927); compattazioni: 40.294 contro 40.810 (+516). La differenza sta quasi tutta nella scrittura di cache (cacheWrite +12.920 token ×1,25), non in input né output (output −41 token).
- **Tool `richiama` (causa principale).** La prima richiesta dopo la prima compattazione: A legge 12.916 token dalla cache e ne scrive ~16.100; B legge 5.222 e ne scrive ~24.200, in tutte e 3 le run (cacheRead −7.694, cacheWrite +8.100: ≈ +8.800 pesati, il 63% della differenza). Il tool viene attivato alla compattazione (`setActiveTools`), cambia il blocco dei tool e rompe il prefisso in cache; dalla seconda compattazione in poi B legge 13.488 contro 13.282 di A, senza penalità. È un costo **una tantum per sessione**, non per turno.
- **Iniezioni (secondaria).** 15 iniezioni in 3 run (5 per run, ognuna rimane nel contesto e viene scritta in cache una volta); le richieste successive di B non hanno scritture anomale. Il resto della differenza (≈ +5.100 pesati) è compatibile con le iniezioni (circa 400 token × 1,25 × 5 ≈ 2.500) più rumore, ma non l'ho isolato con una prova separata (ad esempio B senza iniezioni).
- **Il modello non chiama mai `richiama`** (0 chiamate in 3 run): il tool costa la rottura di cache senza essere usato.
- Prima richiesta della run B11: lettura 0 invece di 5.016, effetto della partenza simultanea di 6 run sulla stessa cache di sistema, non del codice (B12 e B13 sono uguali ad A).
Conseguenza: su sessioni lunghe la penalità si ammortizza (≈ 8.800 pesati una volta per sessione); in questo banco (825.000 pesati) pesa l'1%. Possibili rimedi non provati: non attivare `richiama` (basta l'iniezione automatica, che il modello non chiama comunque), oppure attivarlo con la prima compattazione nel turno in cui il prefisso si rompe comunque. Decisione e prova (banco `long` senza il tool) restano da fare.
