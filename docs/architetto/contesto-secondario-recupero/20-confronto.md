# Confronto repo: recupero dalla storia di sessione
Aggiornato: 2026-11-04 · fase 3. Assunzioni: licenze accettabili = MIT/Apache-2.0; tutte e 6 lo sono. Nessun repo clonato, nessuno eseguito.

| Repo | Approccio | Invarianti | Dipendenze | Dolori noti | Cosa copiare |
|---|---|---|---|---|---|
| claude-mem | Osservazioni riscritte da un modello, iniezione automatica in un blocco con tetto | blocco con delimitatori, tetto con rapporto su cosa è stato tagliato | SQLite, Chroma, worker | costo 50% (#4965), iniezione costante (#4931), efficacia non misurata (#4138) | tetto + rapporto del taglio; degrado a ordine per data |
| hindsight | 4 bracci + RRF k=60 + cross-encoder | recall con budget per livello | Postgres, reranker | JIT (#6306), reranker LLM fragile (#6242) | RRF per fondere BM25 + embedder |
| graphiti | Grafo temporale, estrazione LLM | validità `valid_at/invalid_at` | DB a grafo, LLM | episodi persi in silenzio (#1707) | regola «vince il più recente» |
| mem0 | Fatti estratti da LLM, solo ADD | – | LLM, vettori | fatti superati (#4956, #5352), perdita silenziosa (#5245) | lemmatizzazione BM25 |
| powercontext | Hook SessionStart/UserPromptSubmit, contesto ≤ 8 KB | query = coda del prompt | server Core | misure di costo non ancora fatte (#2467) | hook anche su compact/resume; query a coda |
| letta | Richiamo esplicito come tool (MemGPT) | – | server | codice migrato | solo l'idea (già in `richiama`) |

## Che cosa dicono, per i tre assi del brief
- Recupero senza identificatori: tutti usano ricerca ibrida (BM25 + vettori) con fusione RRF. Il nostro BM25 senza stemming e l'euristica a ≥2 identificatori sono il punto debole; l'embedder locale (`pi-memory/src/embed.ts`) più RRF k=60 è il passo documentato.
- Profondità: nessun repo risolve la profondità: ricostruiscono tutto da una memoria separata. Il nostro archivio grezzo non ha il problema del dato riscritto (#4956, #7283).
- Costo: i due repo più usati (claude-mem, mem0) hanno il costo come dolore principale, perché usano un LLM per estrarre. L'unico vantaggio dichiarato dall'architettura (nessun LLM nel percorso) è verificato dal nostro banco, non dai loro.
- Precisione dell'iniezione: nessuno misura i falsi positivi; claude-mem ha un'ipotesi (#4931) che iniettare spesso nuoce anche senza volume. Da misurare nel nostro banco.

## Query eseguite
`gh search repos`: "agent memory conversation history retrieval" (0), "context compaction coding agent" (0), "letta archival memory", "session transcript search agent bm25" (0), "mem0", "claude code memory recall", "agent memory", "letta-ai", "long-term memory llm agents", "memory layer agents hybrid retrieval" (0), "claude-mem", "context engineering compaction". Salute con `gh api repos/…`, `…/releases/latest`, `…/contributors`.

## Canali muti
`gh search code`, awesome list, deps.dev, fork attivi: non usati (la selezione è stata confermata dopo il solo canale per tema). Alcune query restano vuote per frasi lunghe.

## Segnalazioni per l'ignoto
- Letta: codice di archival search in `letta-code` non letto.
- Nessuno dei sei misura la precisione dell'iniezione automatica: va misurata da noi.
- Dolore non previsto: iniettare a ogni turno può nuocere al compito (claude-mem #4931); il nostro auto-recall inietta solo con ≥2 identificatori, ma la dichiarazione non è provata.
- `file:riga` da verificare a campione: `ContextBuilder.ts:349`, `fusion.py:29`, `edge_operations.py:719`, `prepared_context.py:22`.
