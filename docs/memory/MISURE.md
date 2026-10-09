# Memoria profonda: misure

Tutte riproducibili dalla cartella `pi-memory/` (bench) o dalla radice (eval dal vivo). Macchina: WSL2, Node 24.

## 1. Profondità e scala (`bench/deep-bench.ts`)

Corpus generato (`test/corpus.ts`): ricordi di contorno in 24 domini con link interni, 40 catene di 3 ricordi
(la domanda condivide parole solo con il primo; la risposta è il terzo, collegato con link espliciti o solo con
un'entità in comune), 20 fatti superati, 8 richieste estranee, date su due anni. Si misura cosa arriva davvero negli
spunti che il modello riceve.

```
node --expose-gc bench/deep-bench.ts 1000,10000,100000            # embedder a hashing
node --expose-gc bench/deep-bench.ts 1000,5000 --real [--model=minilm]   # modello vero (embedding in cache su disco)
```

| | Prima | Dopo |
|---|---|---|
| risposta a 1 salto negli spunti | 13–40% | 100% |
| risposta a 2 salti negli spunti | **0%** (1k, 10k) | **93–98%** (1k–100k, hashing) · **95%** e5 1k · **93–95%** e5 5k |
| fatto superato: nuovo / vecchio | 100% / 0 | 100% / 0 |
| richieste estranee con ricordi | 1–2 su 8 | 0–1 su 8 (quello residuo da collisioni dell'embedder a hashing / e5 a 5k) |
| latenza a 100k ricordi (p50 / p95) | 312 / 492 ms | **8–14 / 16–20 ms** |
| heap dell'indice a 100k | 219 MB | 123 MB |
| token per richiesta | ~240 | ~240, uguali da 1k a 100k |

Passi misurati lungo la strada (100k, hashing): scansione O(N) delle entità 47 ms → indice invertito 0,06 ms;
semantica su tutti i vettori ~280 ms → bit di segno + 256 ricalcoli 6 ms; candidati potati prima del punteggio 55 → 24
ms; PPR dai soli colpi entro il 90% del migliore: salto 2 da 55% a 95% con e5 (taratura in `DEPTH.seedShare`, 0,95
dava 100% ma lascerebbe fuori i quasi-pari merito reali).

Modello: con e5 il salto 2 resta al 95% da 1k a 5k ricordi; minilm scende da 93% a 78% → e5 predefinito.

## 2. Un anno simulato (`test/longterm.ts`, `bench/longterm-sim.ts`)

60 argomenti che nascono e muoiono (~60 giorni ciascuno), ricordi nuovi ogni giorno con link, 8 richieste al giorno
sugli argomenti attivi, 20 regole importanti chieste una volta al mese, `/dream` (utilizzi + ciclo di vita) ogni giorno.

```
node bench/longterm-sim.ts 365
```

| | Risultato |
|---|---|
| ricordi attivi | stabili tra ~340 e ~510 dal quinto mese |
| archivio totale | sale fino a ~890 e poi scende (~750): l'oblio pareggia la crescita |
| ricordo più recente di un argomento attivo negli spunti | 78–89% senza recenza → **90–98%** con recenza (0,1 · e^(−età/7 giorni)) |
| regole rare (chieste 1 volta al mese) | **240/240** |
| argomenti chiusi da 4+ mesi ritrovati con la ricerca profonda | **37/37** (dormienti o dimenticati) |
| token per richiesta | 253, costanti tutto l'anno |
| latenza p95 | < 1,3 ms |

## 3. Interfaccia mai bloccata (`test/memory-worker.test.ts`, `test/async-build.test.ts`)

Riscaldare un archivio da 30k ricordi nel worker: thread dell'interfaccia mai fermo più di **30 ms**. La costruzione a
fette nel thread (solo ripiego senza worker) resta sotto ~90 ms per le pause del garbage collector.

## 4. Dal vivo, con Pi e Claude veri (`eval/memory-depth/live.mjs`)

```
node eval/memory-depth/live.mjs --old <memory.ts di confronto>
```

Sei scenari tra 100 ricordi di contorno: tre catene di tre ricordi (la domanda non condivide parole con la risposta),
un fatto superato, una richiesta estranea, "ok".

| | Catene | Superato | Estranea | "ok" | Totale |
|---|---|---|---|---|---|
| memoria nuova | 3/3 | ✓ | ✓ (nessun ricordo) | ✓ | **6/6** |
| memoria precedente | 0/3 (solo il primo ricordo: risposta vaga o sbagliata) | ✓ | ✓ | ✓ | 3/6 |

Esempio (export delle fatture lento, "posso parallelizzarlo di più?"): la memoria precedente richiamava solo
"l'export usa ReportBuilder" e il modello consigliava più worker thread; la nuova richiama la catena fino a "la coda
resta a concorrenza 1: il pod ha 512MB" e il modello risponde di non farlo.

## 5. Costi fissi

| | Token per richiesta |
|---|---|
| progetto senza memoria | 0 (niente quadro, niente spunti, niente tool) |
| tool `ricorda` (solo con una memoria) | ~90 (in cache dopo la prima richiesta) |
| spunti | 0 per le chiacchiere, fino a ~300 (tetto) |
