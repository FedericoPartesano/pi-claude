# Memoria profonda: piano di implementazione

**Spec:** `docs/specs/2026-10-08-deep-memory-design.md` · Esecuzione inline (TDD per ogni task), review finale.
**Test:** `cd pi-memory && npm test` · `node --test extensions/*.test.ts` · `cd pi-memory && npx tsc -p .`

## Vincoli globali

- Costo per richiesta costante: quadro ≤ 1200 caratteri, spunti ≤ 600 caratteri + intestazione, descrizione tool ≤ 60 token.
- Nessuno store → zero token, zero lavoro. Record vecchi leggibili senza migrazione manuale (campi nuovi opzionali).
- Interruttori: `PI_MEMORY_TOOL=0`, `PI_MEMORY_CONTEXT=0`, `PI_MEMORY_FORGET=0`.

## Task

1. **Schema e vettori binari** (`pi-memory/src/store.ts`)
   - `MemoryRecord` += `gist?`, `links?: string[]`, `state?: "dormant"`, `level?: "progetto" | "personale"`,
     `uses?: number`, `lastUsed?: string`.
   - `saveStore` scrive `vectors.bin` (Float32 contigui) + `vectors.idx.json` (`{model, dim, ids}`); `loadStore` legge
     il binario, ripiega su `vectors.json` (migrazione al primo salvataggio, poi `vectors.json` rimosso).
   - Test: round-trip binario; lettura da `vectors.json` vecchio; record senza campi nuovi.
2. **Grafo** (`pi-memory/src/graph.ts`): `buildGraph(records)` → `{ neighbors(id): string[], byEntity(entity): string[] }`
   (link espliciti in entrambi i versi + entità condivise, grado limitato a 20). `recall` usa i link espliciti nella
   diffusione (vicino di un seme: +0.5 × punteggio del seme × forza, entra solo sopra soglia).
   - Test: link bidirezionali; un ricordo collegato ma senza parole in comune con la domanda viene richiamato.
3. **Spunti e budget adattivo** (`recall.ts`, `engine.ts`): `cueLimit(query)` (saluto/chiacchiera 0, domanda 6,
   compito 12); `renderCues(hits, budget=600)` → `- gist #id` (gist o testo tagliato a 90). `Recaller.run` usa gli spunti;
   esclude `state: "dormant"` (tranne `includeSuperseded`).
   - Test: 12 spunti nel budget; "ciao" → 0; dormienti esclusi; intestazione "non sono una richiesta".
4. **Quadro** (`engine.ts`, `memory-core.ts`, `memory.ts`): proposta di `/dream` += `gist` (testo del quadro), per voce
   `gist` breve, `links`, `level`; `parseProposal` li accetta; `/dream` scrive `gist.md` (tagliato a 1200). `Recaller.core`
   = `gist.md` + i fissati non già citati, entro 1200 + 400 personali.
   - Test: parse con i campi nuovi; core con e senza `gist.md`; taglio.
5. **Salienza** (`memory-core.ts`): `filterProposal(proposal, memory)`: scarta aggiunte senza contenuto (chiacchiere,
   messaggi casuali, richieste di chiarimento, "clear"), episodi senza entità né lezione, doppioni (similarità parole
   ≥ 0.8 con un ricordo → rinforzo). Criteri di salienza nel prompt di `/dream`.
   - Test: l'episodio "messaggi casuali (asd…) … clear" scartato; doppione → rinforzo; un episodio con lezione resta.
6. **Oblio** (`pi-memory/src/forget.ts`): `lifecycle(records, today, { fileExists })` → `{ records, dormant[], forgotten[] }`.
   Regole della spec (90 + 90 giorni, file scomparsi → dormiente, esenti fissati e correzioni ≥ 2). `/dream` lo applica,
   scrive `forgotten.jsonl`; `/memory restore <id>` ripristina entro 30 giorni. Il riepilogo dice cosa è stato dimenticato.
   - Test: ogni transizione; esenzioni; uso recente salva un ricordo vecchio.
7. **Tool `ricorda`** (`extensions/memory.ts`, logica in `pi-memory/src/deep.ts`): `{id}` → ricordo completo + vicini;
   `{query}` → ricerca profonda (dormienti/superati segnalati); `{episodio}` → `searchEpisodes(files, query)` sulle
   sessioni del progetto (finestre di messaggi, BM25, max 1500 caratteri). Ogni uso: `uses++`, `lastUsed`.
   - Test: le tre forme; tetto 1500; uso registrato.
8. **Richiamo dal contesto** (`deep.ts` + hook `tool_result` in `memory.ts`): `contextCues(path, graph, records, seen)` →
   max 3 righe per file nuovo; azzerato a `session_compact`.
   - Test: file citato → spunti; seconda volta → niente; file sconosciuto → niente.
9. **Livello personale**: le aggiunte con `level: "personale"` vanno nello store globale.
   - Test: in `memory-deep.test.ts`.
10. **Export Obsidian** (`deep.ts` `renderVault(records)` + `/memory export`): un `.md` per ricordo con frontmatter e
    `[[id]]`. - Test: file e link.
11. **Scala e misure** (`scale.test.ts`, `bench/`): 10.000 ricordi: richiamo < 5 ms senza embedding della domanda, token
    costanti (50/1.000/10.000), RAM. Scenario di profondità con link a 1 salto.
