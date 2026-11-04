Aggiornato: 2026-11-03 · fase 1b

# Mappa del territorio: gestione del contesto di un agente
Fonti: MemGPT (arXiv 2310.08560), documentazione Anthropic *Context editing*, cookbook *Context engineering*, *The Complexity Trap* (arXiv 2508.21433), simulatore di invalidazione cache di Induction. Ricerca con DuckDuckGo (Exa in rate limit).

## 1. Concetti
- **Memoria gerarchica** (MemGPT): contesto principale (RAM: istruzioni, memoria di lavoro, coda FIFO) e contesto esterno (disco: archivio e storia dei messaggi). Il dato esterno «deve sempre essere spostato esplicitamente» nel contesto principale. — coperta (il cestino è il contesto esterno).
- **Tre leve distinte** (cookbook Anthropic): *clearing* dei risultati dei tool (costo zero, senza perdita se il tool è rilanciabile), *compaction* (riassunto, con perdita), *memory* (tra sessioni). — non coperta: l'idea dell'utente fonde le prime due.
- **Observation masking**: sostituire i vecchi risultati dei tool con un segnaposto, tenendo gli ultimi M turni. — coperta (è il «cestino» senza il cestino).

## 2. Pattern noti
- MemGPT: *queue manager* del sistema sfratta la coda quando supera una soglia (avviso al ~70%, flush al ~100%, sfratto di ~50%; valori d'esempio) e produce un riassunto ricorsivo; è il **modello** a decidere cosa salvare nella memoria prima dello sfratto. — coperta in parte.
- Anthropic `clear_tool_uses`: `trigger` (default 100k token), `keep` (3), `clear_at_least`, `exclude_tools`, `clear_tool_inputs`. — non coperta: `clear_at_least` esiste proprio perché lo sfratto rompe la cache.
- Generazionale + promozione per frequenza (idea dell'utente): analogia con GC generazionali e con cache ARC/LFU. Nessuna fonte di sistemi LLM trovata che promuova per numero di richiami. — coperta, `nessuna fonte trovata` per i LLM.

## 3. Trade-off
- Sfrattare = riscrivere la cache: costo 1,25× l'intero contesto dopo il primo punto modificato (documentazione Anthropic: «You'll incur cache write costs each time content is cleared»). — **non coperta**, decisiva (vedi `20-confronto.md`).
- Masking vs riassunto: costo simile, masking non peggiore (Complexity Trap); l'ibrido non è testato dagli autori. — coperta.

## 4. Modi di fallimento
- L'agente rilegge ciò che è stato cancellato (cookbook: «Watch for»). — coperta come richiamo.
- Il clearing non aiuta con ragionamento e messaggi dell'utente. — coperta dal perimetro.
- Segnale di richiamo censurato: il modello non richiama ciò che non sa di aver perso. — coperta come ipotesi del brief.
- Staleness: un risultato nel cestino riguarda un file poi modificato. — **non coperta**: il richiamo deve invalidare su scritture.

## 5. Attributi di qualità
Quota (nominato, portante), qualità, affidabilità, manutenzione: coperti. Sicurezza: i risultati dei tool possono contenere segreti; il cestino su disco li ripete (il transcript li ha già). — non coperta, impatto nullo (nessun dato nuovo).

## 6. Strumenti e standard
- Server-side `clear_tool_uses` (beta `context-management-2025-06-27`): **non raggiungibile**, `claude -p` 2.1.314 non ha un flag `context_management` (`claude --help`, solo `--autocompact`). — coperta, risolve un ignoto dello studio precedente.

## 7. Controversie
Riassunto contro masking; riassumere con modello piccolo o col grande; ibridi. — differita (si decide dopo la misura).
