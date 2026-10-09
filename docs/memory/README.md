# Memoria profonda di Pi

Memoria a lungo termine per progetto (e personale), pensata per crescere senza limiti pratici senza far crescere i token
per richiesta né rallentare l'interfaccia. Funziona come quella di una persona: un quadro sempre presente, spunti che
affiorano quando la richiesta li richiama, la possibilità di andare a fondo, e un sonno (`/dream`) che consolida, collega
e dimentica.

Le misure che giustificano ogni scelta sono in [MISURE.md](MISURE.md); le fonti della ricerca in
[../research/2026-10-08-agent-memory.md](../research/2026-10-08-agent-memory.md); la spec in
[../specs/2026-10-08-deep-memory-design.md](../specs/2026-10-08-deep-memory-design.md).

## Come funziona, in breve

```
sessioni ──/dream (LLM, 1×/giorno)──▶ ricordi (JSONL) + link + entità + vettori e5
                                              │
            ogni messaggio dell'utente ───────┤  worker thread (mai sul thread dell'interfaccia)
                                              ▼
            1. richiamo diretto: BM25 + entità + embedding (vettori binari → coseno esatto sui migliori)
            2. richiamo profondo: PageRank personalizzato (push) dai colpi migliori sul grafo dei ricordi
            3. spunti: ≤ 12 righe, tetto 1080 caratteri (~300 token), i 2 più forti interi, i "↳ collegati"
                                              │
            modello ◀── un solo messaggio utente (richiesta + spunti) ── se serve: tool `ricorda` (#id o domanda)
```

- **Grafo.** Ogni ricordo è un nodo: ha `links` (id di ricordi che spiega, da cui dipende, che contraddice: li propone
  `/dream`) ed `entities` (file, servizi, requisiti). Due ricordi con un'entità *specifica* in comune (usata da al più 30
  ricordi) sono vicini; le entità più diffuse (hub, es. il nome del progetto) non collegano nulla.
- **Profondità.** Dai colpi diretti entro il 90% del migliore parte un PageRank personalizzato approssimato (push di
  Andersen-Chung-Lang, restart 0.5, ε 1e-4): il costo dipende dal vicinato, non dalla dimensione della memoria. Il 40%
  degli spunti è riservato a ciò che raggiunge (`↳ collegato`): è ciò che porta dalla domanda ("l'export è lento") al
  motivo due passi più in là ("la coda resta a concorrenza 1: il pod ha 512MB").
- **Mentre si lavora.** Quando Pi legge o modifica un file, in coda al risultato arrivano (al massimo 3 righe, una
  volta per file e sessione) i ricordi che citano quel file: il "su questo file c'era quel problema" di una persona.
- **Token costanti.** Spunti con tetto fisso; niente ricordi per le chiacchiere ("ok", "procedi"); il tool `ricorda`
  esiste solo nei progetti con una memoria (~90 token, cache) e il dettaglio si paga solo quando il modello lo chiede.
- **Velocità.** Vettori come bit di segno (Hamming su tutti, coseno esatto sui 256 migliori), indici invertiti in
  forma compatta (CSR), candidati potati prima del punteggio completo, forza e recenza in cache. Tutto nel worker:
  l'interfaccia manda la domanda e riceve gli spunti.
- **Scritture sicure.** Un solo scrittore per archivio (`lock.ts`, lucchetto con scadenza): `/dream` ribasa il suo
  risultato sull'archivio com'è al momento di salvare (le modifiche e le cancellazioni fatte nel frattempo vincono, i
  ricordi aggiunti da un'altra sessione restano); il calcolo dei vettori scrive solo i vettori. Gli id non tornano mai in
  uso (`ids.json`): un ricordo unito o dimenticato non passa il suo numero, con i suoi link, a uno nuovo. Unire o
  aggiornare un ricordo conserva link e utilizzi, e i link che puntavano a lui lo seguono.
- **Nel tempo.** Recenza (le ultime settimane prima della storia), forza (conferme), oblio: 90 giorni senza conferme
  né richiami → dormiente (fuori dagli spunti), altri 90 → dimenticato (fuori dall'archivio, in `forgotten.jsonl`, ancora
  trovato da una ricerca profonda). Mai dimenticati: fissati, correzioni confermate 2 volte, ricordi confermati 3 volte.

## Mappa del codice

### `pi-memory/src/` (logica pura, testata)

| File | Responsabilità |
|---|---|
| `store.ts` | `MemoryRecord` (campi: tipo, testo, conferme, date, stato, entità, `links`, `gist`, `state`/`dormantSince`, `level`, `uses`/`lastUsed`, `forgottenAt`); `memories.jsonl` + `vectors.bin` (Float32 contigui) e `vectors.idx.json`; migrazione dal vecchio `vectors.json` e da `memory.md`. |
| `recall.ts` | Il richiamo. `RecallIndex` (BM25 in liste CSR, indice entità e gettoni, link per posizione, costruzione sincrona o a fette con `build`), `recall()` (fusione lessicale/entità/semantica, forza e recenza, soglie, PPR e posti riservati), `renderCues` e `cueLimit` (spunti a budget adattivo), `isSmallTalk`, `recallMessage`, `coreSection`. Parametri `DEPTH`, `RECENCY`, `HUB_DEGREE`. |
| `ppr.ts` | `pushPpr`: PageRank personalizzato approssimato per push, con tetto di lavoro e nodi hub non espansi. |
| `vector-index.ts` | `VectorIndex`: bit di segno + distanza di Hamming su tutti i vettori, coseno esatto sui migliori. |
| `graph.ts` | `buildGraph`: grafo per id (link nei due sensi, entità condivise) per usi fuori dall'indice. |
| `engine.ts` | `Recaller`: carica gli archivi (progetto + globale "g:"), costruisce una volta l'indice unito e i vettori, `run` (spunti + ricerca profonda nei dimenticati), `open` (un ricordo con i vicini), `forFile` (ricordi che citano un file), `core` (quadro + fissati), `hasVectors`; `fillVectors`. |
| `memory-handlers.ts` | Il lavoro della memoria (modello + `Recaller`) per il worker e per il ripiego in thread. |
| `memory-worker.ts` | Il worker thread: riceve i messaggi e chiama gli handler. |
| `memory-worker-client.ts` | `MemoryWorker` (lato Pi): `recall`, `open`, `core`, `warm`, `fillVectors`, `embed`; scarica il modello dopo 10 minuti di inattività (l'indice resta); riferito solo con richieste in volo; se il worker muore le richieste in sospeso sono rifatte in thread. |
| `forget.ts` | `lifecycle` (dormiente, risveglio, dimenticato, esenzioni, file scomparsi), `applyUsage` (utilizzi dal registro dei richiami, ciascuno una volta), `newestEvent`. |
| `reconcile.ts` | Ponte tra archivio e consolidamento: `recordsToEntries`, `entriesToRecords` (conserva link, gist, stato, livello, utilizzi; eredità e reindirizzamento dei link per unioni e aggiornamenti; link `n<k>` tra ricordi nuovi; link potati), `movePersonal` (preferenze personali all'archivio globale), `rebaseOnCurrent` (il risultato di `/dream` sopra le scritture avvenute nel frattempo). |
| `lock.ts` | `withStoreLock`: un solo scrittore per archivio (cartella `.lock`, scaduta dopo 30 s). |
| `vault.ts` | `renderVault`: la memoria come vault Obsidian (`/memory export`). |
| `request.ts` | `classifyRequest` (modifica, domanda, altro), ambito delle regole. |
| `entities.ts` | Entità estratte dal testo (percorsi, identificatori). |
| `strength.ts` | Forza di un ricordo: conferme e sbiadire lento. |
| `embed.ts`, `embed-worker.ts` | Modelli (`e5` predefinito, `minilm`), embedder in thread, in worker, finto per i test. |
| `dashboard*.ts` | Dashboard `/memory`: ricordi, cronologia dei `/dream`, registro dei richiami, domande; `logUsage` (gli utilizzi dei ricordi personali anche nel registro globale). |

### `extensions/` (integrazione con Pi)

| File | Responsabilità |
|---|---|
| `memory.ts` | L'estensione: a ogni richiesta quadro nel prompt di sistema e spunti nel messaggio (via worker); nota sui file letti o modificati (`fileNote`); `/dream` (anche automatico una volta al giorno), `/memory`, `/ricorda`; il tool `ricorda`; il ciclo di vita, lo spostamento delle preferenze personali e il quadro (`gist.md`) a ogni `/dream`. |
| `memory-core.ts` | Consolidamento: prompt di `/dream` (link, gist, livello, cosa non salvare), `parseProposal`, `applyProposal`, `filterProposal` (scarta ciò che non ha contenuto, i quasi-doppioni diventano conferme), lettura delle sessioni a lotti, maschera dei segreti. |

### `pi-claude-code/src/user-turn.ts`

I messaggi utente di un turno (richiesta + spunti) arrivano a Claude Code come **un solo messaggio**: separati, Claude
Code rispondeva a ciascuno come a un turno e le risposte si sfasavano di un turno.

## Parametri e interruttori

| Variabile | Effetto |
|---|---|
| `PI_MEMORY_MODE=capped` | Vecchia memoria (`memory.md` con tetto) invece di quella profonda. |
| `PI_MEMORY_MODEL=e5\|minilm` | Modello degli embedding (predefinito e5). |
| `PI_MEMORY_TOOL=0` | Niente tool `ricorda`. |
| `PI_MEMORY_FORGET=0` | Niente ciclo di vita a `/dream`. |
| `PI_MEMORY_CONTEXT=0` | Niente nota della memoria sui file letti o modificati. |
| `PI_MEMORY_AUTODREAM=0` | Niente `/dream` automatico. |
| `PI_MEMORY_EMBED_IDLE_MS` | Dopo quanto il modello si scarica (predefinito 10 minuti). |
| `PI_MEMORY_RECALL_LOG=1` | Registro dettagliato dei richiami in `.pi/memory/recall-log.jsonl`. |

Nel codice: `DEPTH` (semi, quota degli spunti per i collegati, restart), `RECENCY` (0.1, 7 giorni), `HUB_DEGREE` (30),
`DORMANT_AFTER_DAYS`/`FORGET_AFTER_DAYS` (90/90), `KEEP_CONFIRMATIONS` (3).

## File su disco (`.pi/memory/` del progetto, `~/.pi/agent/memory/` personale)

`memories.jsonl` (i ricordi), `vectors.bin` + `vectors.idx.json` (embedding), `gist.md` (il quadro del progetto),
`forgotten.jsonl` (dimenticati, recuperabili), `ids.json` (l'ultimo id dato), `recall-events.jsonl` (ultimi richiami:
utilizzi), `dream-log.jsonl` (cronologia dei `/dream`), `usage-since` (fin dove gli utilizzi sono già contati), `vault/`
(dopo `/memory export`), `.lock` (solo durante una scrittura). `.pi/` è escluso da git localmente (`.git/info/exclude`).
