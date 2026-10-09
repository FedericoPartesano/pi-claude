# Memoria a lungo termine per coding agent: stato dell'arte e cosa portare

Data: 2026-10-08. Fonti primarie dove indicato; le cifre marcate **[stima]** sono calcoli/ipotesi nostri, non misure da paper. Le cifre non ri-verificate riga per riga sul PDF sono marcate **[da verificare]**.

## 1. Sistemi di riferimento e meccanismi portabili

### Zep / Graphiti (https://arxiv.org/abs/2501.13956, https://github.com/getzep/graphiti)
- Grafo a tre livelli: episodi (messaggi grezzi), entità+fatti semantici (edge), community (cluster riassunti).
- **Bi-temporale**: ogni edge ha `valid_at`/`invalid_at` (tempo del mondo) e `created_at`/`expired_at` (tempo di ingestione). Un fatto contraddetto NON si cancella: si imposta `invalid_at` e si tiene lo storico.
- Ingestione: entity extraction LLM, dedup entità via embedding + full-text, poi LLM decide se il nuovo edge contraddice edge esistenti con le stesse entità (candidati ristretti con ricerca ibrida, non scan totale).
- Retrieval: cosine + BM25 + BFS dal grafo, poi rerank (RRF, MMR, episode-mentions, distanza dal nodo). Nessuna chiamata LLM in lettura: latenza p95 ~300 ms.
- Risultati: DMR 94.8% vs 93.4% MemGPT; LongMemEval fino a +18.5% accuracy e -90% latenza vs full-context.
- **Portabile**: campi `validAt/invalidAt` + `supersededBy` sul record; l'invalidazione avviene in /dream confrontando solo i candidati che condividono entità.

### Mem0 / Mem0g (https://arxiv.org/abs/2504.19413)
- Pipeline a due fasi: *extraction* (LLM estrae fatti candidati da ultimo scambio + summary + ultimi m messaggi) e *update*: per ogni fatto si recuperano top-s memorie simili e l'LLM sceglie tra ADD / UPDATE / DELETE / NOOP. È il pattern di dedup+superseding più semplice e già pronto per /dream.
- Mem0g: grafo entità-relazione-entità con timestamp; conflitti marcati invalidi, non eliminati.
- LoCoMo (LLM-judge J): Mem0 ~66.9, Mem0g ~68.4; p95 totale 1.44 s contro >17 s full-context; ~7k token/convo (Mem0), ~14k (Mem0g) vs ~26k full-context **[da verificare]**. Nota: il grafo aggiunge solo ~2 punti, più utile su temporal e multi-hop.
- Caveat: numeri auto-riportati; Zep ha contestato la loro valutazione.

### Letta / MemGPT (https://arxiv.org/abs/2310.08560, https://docs.letta.com)
- **Core memory** (blocchi sempre nel prompt, piccoli, modificabili dall'agente: persona, utente, progetto) + **archival/recall memory** (fuori contesto, ricerca vettoriale/testo via tool). L'agente si auto-edita con tool (`core_memory_append/replace`, `archival_memory_insert/search`); pressione di contesto → eviction + recursive summary.
- **Portabile**: un piccolo blocco "core" a budget fisso (es. 300-400 token) con i fatti stabili del progetto (stack, convenzioni, preferenze) sempre iniettato; il resto solo via cue. Rischio: self-editing costa token e tool call per turno, in contrasto con il vincolo "costo fisso ~zero": farlo solo offline in /dream.

### A-MEM (https://arxiv.org/abs/2502.12110, NeurIPS 2025)
- Ogni nota: contenuto, keywords, tags, descrizione contestuale, embedding, link. Alla creazione: top-k vicini per embedding → LLM decide link; *memory evolution*: i vicini vengono riscritti (tags/context) alla luce della nuova nota.
- Forte su multi-hop LoCoMo rispetto a MemGPT/LoCoMo baseline (cifre esatte [da verificare]).
- **Portabile**: la fase "link generation" a /dream (top-k=10 vicini per embedding → LLM sceglie 0-3 link tipizzati). L'evoluzione dei vicini è costosa e rischia drift: limitarla ad aggiornare `summary` di un cluster, non i record originali.

### MemoryBank (https://arxiv.org/abs/2305.10250)
- Ebbinghaus: ritenzione R = exp(-t/S), S cresce a ogni richiamo (reset di t). Implementazione reale rozza (S intero incrementato), ma il principio è corretto e coincide con il vostro "confirmations × time decay".
- **Parametri proposti** **[stima]**: S0 = 14 giorni, S ← S·1.6 per ogni conferma/recall utile (cap 365 gg); sotto R<0.05 il record va in *archivio freddo* (fuori indice caldo, recuperabile), mai cancellato di colpo.

### Generative Agents (https://arxiv.org/abs/2304.03442)
- Score = α·recency + β·importance + γ·relevance, tutti normalizzati min-max in [0,1], α=β=γ=1; recency = 0.995^(ore dall'ultimo accesso); importance 1-10 data dall'LLM alla scrittura (qui: a /dream); **reflection** quando somma importance recenti > 150: l'LLM formula domande salienti sulle ultime 100 memorie e scrive insight di livello superiore che citano le sorgenti (albero di riflessioni).
- **Portabile**: importance come campo scritto a /dream (costo zero in lettura); reflection = il vostro /dream che produce memorie "di sintesi" linkate alle sorgenti.

### HippoRAG / HippoRAG 2 (https://arxiv.org/abs/2405.14831, https://arxiv.org/abs/2502.14802, https://github.com/OSU-NLP-Group/HippoRAG)
- Indexing: OpenIE (LLM) estrae triple → grafo di entità (nodi "phrase") con archi pesati; HippoRAG 2 aggiunge nodi *passage* collegati alle entità che contengono, e archi di sinonimia tra entità con cosine > soglia sugli embedding.
- Query: (1) NER sulla query → seed; (2) linking seed → nodi per embedding; HippoRAG 2 fa linking **query-to-triple** (embedding della query contro triple) e poi un filtro di riconoscimento LLM; i seed passage ricevono peso ×0.05 relativo agli entity-seed (parametro "passage node weight"); (3) **Personalized PageRank** con damping 0.5 (restart 0.5), reset distribution sui seed; (4) i passage si ordinano per massa PPR (mix con dense retrieval).
- Risultati: HippoRAG fino a +20% su MuSiQue/2Wiki vs retriever dense, 10-30x più economico e 6-13x più veloce di IRCoT iterativo. HippoRAG 2 recupera anche su fattuale/associativo/sense-making dove HippoRAG 1 regrediva; Recall@5 medio ~+7 punti su NV-Embed-v2 baseline **[da verificare]**.
- **Il più portabile per il vostro obiettivo (2)**. PPR su un grafo di 100k nodi con ~5 archi medi = 500k archi: 20 iterazioni di power iteration ≈ 10M operazioni ≈ 20-50 ms in JS **[stima]**: troppo se fatto sull'intero grafo, ma con *push-style approximate PPR* (Andersen-Chung-Lang, epsilon 1e-4) il costo è proporzionale al vicinato dei seed, ~1-3 ms.

### LightRAG e GraphRAG (https://arxiv.org/abs/2410.05779, https://arxiv.org/abs/2404.16130)
- GraphRAG: entity graph → community detection (Leiden) gerarchica → summary per community. *Local search*: entità vicine alla query + loro vicinato + text unit; *global search*: map-reduce sui summary di community (costoso, per domande "tema generale"). Indexing molto caro in token.
- LightRAG: retrieval a due livelli: *low-level* (keyword di entità → nodi) e *high-level* (keyword tematici → relazioni/edge descritti); aggiornamento incrementale senza rifare le community. Dichiara win-rate > NaiveRAG/GraphRAG su dataset UltraDomain (LLM-judge).
- **Portabile**: l'idea di indicizzare *anche gli edge* con una descrizione testuale embeddata (relazione = documento ricercabile) e keyword di due tipi (entità vs tema) estratte dalla query. Global search/Leiden: solo opzionale offline, per generare 1 "summary di cluster" a /dream.

### RAPTOR (https://arxiv.org/abs/2401.18059)
- Chunk → embedding → clustering (UMAP + GMM soft) → summary LLM → ricorsione fino a radice. Retrieval *collapsed tree*: tutti i nodi (foglie+summary) in un unico indice, top-k per cosine con budget token. +20% assoluto su QuALITY con GPT-4.
- **Portabile**: i summary di /dream sono nodi di livello superiore nello stesso indice; la query ricade sul livello di astrazione giusto senza logica speciale. Per 100k memorie: ~1 summary ogni 10 record → +10k nodi.

### Vault Obsidian con [[link]]
- Non è un paper: file markdown, link `[[nota]]`, backlinks, tag, frontmatter YAML. Valore: trasparenza e editabilità umana. Le implementazioni "memoria per agenti su Obsidian" sono quasi tutte lettura di file + grep/embedding + espansione sui backlink: equivalente a vostro 1-hop spreading. Backlink = indice inverso degli edge (da avere comunque). **Portabile**: formato di *export* (non storage primario) per ispezione umana; JSONL resta più veloce da caricare.

### "graphify"
È uno strumento reale: https://github.com/Graphify-Labs/graphify (MIT, Python, decine di migliaia di stelle secondo le pagine di terzi, es. https://graphify.com/what-is-graphify, https://www.augmentcode.com/learn/graphify-knowledge-graphs-ai-coding). Trasforma codebase/docs/PDF/immagini/video in un knowledge graph: AST con tree-sitter in locale (deterministico), estrazione semantica LLM opzionale per docs/media; output in `graphify-out/` (HTML interattivo, JSON, query/path/explain da CLI); si installa come skill negli assistenti (è lo stesso che avete in `~/.claude/skills/graphify`). **Rilevanza**: è un grafo *del codice* (struttura statica), complementare e non sostitutivo alla memoria conversazionale; utile come fonte di entità (file, simboli) per il vostro entity linking. Dettagli interni non verificati sul repo.

## 2. Ricerca vettoriale scalabile in JS/TS

Footprint 100k × 384 dim (calcolo esatto):
| Formato | Byte/vettore | Totale 100k |
|---|---|---|
| float32 | 1536 | 153.6 MB |
| int8 (scalar) | 384 | 38.4 MB |
| binary (1 bit) | 48 | 4.8 MB |

- **usearch** (https://github.com/unum-cloud/usearch, npm `usearch`): binding nativo N-API, HNSW, dtype `f32,bf16,f16,e5m2,u8,i8,b1`, metriche cosine/ip/hamming, save/load/view (mmap). Pre-built binaries per linux/mac/win. Ordine di grandezza HNSW 100k×384: ricerca k=10 ~0.1-0.5 ms **[stima]**, build ~10-30 s a f32 **[stima]**. Un binario nativo però rompe "installazione leggera": valutare peso e fallback.
- **hnswlib-node** (https://github.com/yoshoku/hnswlib-node): binding C++ hnswlib, solo f32 (153 MB + grafo M=16 ≈ +13 MB), insert incrementale, no delete vero (mark-deleted). Funziona, ma più memoria e niente quantizzazione.
- **Pure JS/WASM**: esistono HNSW in puro JS (es. `hnsw`, `@harperfast/hnsw` con int8 e mmap, https://socket.dev/npm/package/@harperfast/hnsw); qualità/manutenzione variabili, 3-10x più lenti del nativo.
- **Alternativa consigliata senza indice ANN**: *binary quantization + rescoring*. Segno di ogni dimensione → 48 byte; ricerca = XOR+popcount su 12 `Uint32` per vettore: 100k × 12 = 1.2M operazioni ≈ **2-5 ms in JS** **[stima]**; si prendono i top-200 e si ri-rankano con cosine f32 (o int8) dei 200 vettori (<0.5 ms). Letteratura: BQ+rescoring mantiene ~92-96% del recall (Hugging Face/Cohere, https://huggingface.co/blog/embedding-quantization) con modelli che lo tollerano; **e5-small non è addestrato per BQ**: va misurato (recall@10 vs f32 sul vostro set) prima di adottarlo; per sicurezza usare overshoot 4-10x.
- Brute force f32 puro su 100k×384: 38M multiply-add ≈ 25-50 ms in JS **[stima]**: fuori budget oltre ~40k vettori. Int8 non aiuta molto in JS puro (nessuna SIMD).
- Realistico: sotto 20 ms, 100k memorie → BQ+rescore (4.8 MB residente + f32 su disco mmap/lazy) con BM25 su inverted index e PPR approssimato; sopra 500k → usearch.

## 3. Benchmark

- **LoCoMo** (https://arxiv.org/abs/2402.17753, https://snap-research.github.io/locomo/): 10 conversazioni lunghe (~300 turn, ~9k token medi, fino a 35 sessioni), QA in categorie: single-hop, multi-hop, temporal, open-domain, adversarial. Metriche F1/BLEU, spesso LLM-judge. Full-context a 128k oggi lo satura quasi: i risultati dei sistemi di memoria vanno letti come *costo/latenza a parità di qualità*, non come accuratezza assoluta. Su multi-hop e temporal i sistemi a grafo (Mem0g, Zep, A-MEM) guadagnano di più.
- **LongMemEval** (https://arxiv.org/abs/2410.10813, ICLR 2025): 500 domande su storie di 115k token (S) o ~1.5M (M); cinque abilità: information extraction, multi-session reasoning, temporal reasoning, knowledge updates, abstention. Gli assistenti commerciali e i long-context cadono di ~30%. Ricette che aiutano (e portabili): indicizzare a granularità di *fatto* oltre che di sessione ("fact-augmented key expansion"), **time-aware query expansion** (usare i metadati temporali per restringere), reading con Chain-of-Note. Questo benchmark misura esattamente l'obiettivo (3) "knowledge updates" = superseding.
- **MSC** (Multi-Session Chat, https://arxiv.org/abs/2107.07567): 5 sessioni, persona consistency; oggi poco discriminante, serve come test di base.
- Lacuna: nessuno misura *coding agent* (preferenze di repo, decisioni, bug risolti). Servirà un eval interno: ~50 query multi-hop costruite a mano dalle vostre sessioni reali (già avete `eval/` nel repo pi-claude).

## 4. Raccomandazione, in ordine beneficio/costo

Vincoli: <20 ms CPU/messaggio, costo token costante, zero DB esterno, lettura senza LLM.

1. **Entity-seeded approximate PPR al posto del solo 1-hop** (beneficio alto per l'obiettivo 2, costo basso: ~150 righe, nessun costo token). Parametri di partenza: seed = top-5 entità (match esatto/alias sulla query + entità delle top-5 memorie dense/BM25); peso seed memoria = 0.05× quello entità (stile HippoRAG 2); **damping 0.5** (restart 0.5; alfa 0.5 favorisce i vicini vicini), push-PPR con epsilon 1e-4 (≈ 15-20 iterazioni equivalenti), limite 2000 nodi visitati, archi pesati per tipo (`entità-condivisa`=1, `link esplicito`=1.5, `supersedes`=0) e degree normalization (peso ÷ log(2+deg)) per evitare hub (es. entità "repo"). Fusione finale: punteggio = 0.45·dense + 0.25·BM25 + 0.30·PPR-normalizzato, poi × strength. Misurare con A/B su query multi-hop.
2. **Indice a due fasi: BM25 inverted index + vettori binari con rescoring** (obiettivo 1). Mantiene RAM ~5 MB/100k e 3-8 ms totali [stima]. Verificare recall con e5-small prima; fallback: int8 su top-N BM25 ∪ top-N entità (candidate generation lessicale/grafica, poi cosine esatta solo su ≤2000 candidati).
3. **Bi-temporalità e superseding in /dream** (obiettivo 3): campi `validFrom`, `invalidAt`, `supersededBy`, `confirmations`, `importance`. Passo Mem0: per ogni memoria nuova, candidati = top-5 per embedding ∪ memorie con entità in comune; un solo prompt batch → ADD/UPDATE/INVALIDATE/NOOP. I record invalidati escono dall'indice caldo ma restano nel JSONL (storico, rollback). Costo: token solo a /dream.
4. **Forgetting Ebbinghaus a livelli**: strength = importance·exp(-Δt/S), S0=14 gg, ×1.6 a ogni recall *usato* o conferma, cap 365 gg; sotto 0.05 → archivio freddo (non in indice); pin per memorie importance ≥ 9. Garbage collection a /dream, mai in lettura.
5. **Livello sintesi (RAPTOR/reflection) a /dream**: ogni 10-30 memorie di una componente connessa → una memoria di sintesi linkata alle sorgenti (importance alta, indicizzata come le altre). Trigger stile Generative Agents: somma importance non sintetizzate > 150. Dà "global search" gratis a costo di lettura zero e ridà budget ai cue.
6. **Core block fisso** (Letta): 300-400 token sempre presenti con fatti stabili di progetto, aggiornato solo da /dream; i cue dinamici hanno budget separato (es. 3-5 cue × ~60 token = 300 max). Costante per richiesta.
7. **Time-aware query filter** (LongMemEval): se la query contiene espressioni temporali ("ieri", "la settimana scorsa") filtrare/boost per `validFrom`. Costo bassissimo, regex.
8. **Link generation a /dream** (A-MEM): top-10 vicini → LLM propone 0-3 link tipizzati (`causa`, `dipende-da`, `corregge`, `stessa-feature`); i link espliciti sono gli archi con peso più alto nel PPR. Non riscrivere le memorie esistenti (evitare drift), solo aggiungere archi.
9. **Opzionali / rinviare**: Leiden e global search (costo alto, beneficio poco chiaro su coding), self-editing online di Letta (token per turno), Obsidian solo come export, usearch solo oltre ~300-500k memorie.

Ordine di implementazione: 2 → 1 → 3 → 4 → 5/6, con eval multi-hop interno prima di ogni passo e misura latenza p95 a 10k/100k record sintetici. Regola di misura: ogni taglio recuperabile (coerente con "affidabilità prima dei token").

## Fonti principali
- Zep https://arxiv.org/abs/2501.13956 · Graphiti https://github.com/getzep/graphiti
- Mem0 https://arxiv.org/abs/2504.19413
- MemGPT https://arxiv.org/abs/2310.08560 · Letta https://docs.letta.com
- A-MEM https://arxiv.org/abs/2502.12110
- MemoryBank https://arxiv.org/abs/2305.10250
- Generative Agents https://arxiv.org/abs/2304.03442
- HippoRAG https://arxiv.org/abs/2405.14831 · HippoRAG 2 https://arxiv.org/abs/2502.14802
- LightRAG https://arxiv.org/abs/2410.05779 · GraphRAG https://arxiv.org/abs/2404.16130 · RAPTOR https://arxiv.org/abs/2401.18059
- LoCoMo https://arxiv.org/abs/2402.17753 · LongMemEval https://arxiv.org/abs/2410.10813 · MSC https://arxiv.org/abs/2107.07567
- usearch https://github.com/unum-cloud/usearch · hnswlib-node https://github.com/yoshoku/hnswlib-node · quantization https://huggingface.co/blog/embedding-quantization
- graphify https://github.com/Graphify-Labs/graphify
