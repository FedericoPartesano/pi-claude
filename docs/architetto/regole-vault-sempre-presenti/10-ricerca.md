Aggiornato: 2026-10-23 · fase 2

## D1 — Come gli agenti di codice caricano le regole
- Claude Code: CLAUDE.md caricato a inizio sessione come messaggio utente dopo il system prompt (https://code.claude.com/docs/en/glossary); ci sono anche regole con `paths:` caricate al bisogno (https://claude.com/resources/articles/steering-claude-code-skills-hooks-rules-subagents-and-more).
- Cursor: le regole applicate stanno all'inizio del contesto (https://cursor.com/docs/rules); modalità sempre attiva, per glob, decisa dall'agente, su invocazione (https://docs.devin.ai/cli/extensibility/rules, stessa tassonomia).
- Sub-agenti: il contesto parte vuoto; dal genitore passa solo il prompt del tool (https://code.claude.com/docs/en/agent-sdk/subagents). Segnalato come non documentato e verificato da test che CLAUDE.md di progetto non viene iniettato nei sub-agenti (https://github.com/anthropics/claude-code/issues/62944, issue, non fonte primaria). Stesso problema nostro: ogni figlio riceve solo `--append-system-prompt` del ruolo.
- Pi carica una catena fissa di AGENTS.md all'avvio, senza attivazione lazy (https://github.com/mokronos/instructmd/blob/main/docs/agent-instruction-discovery.md, secondaria).

## D2 — Quante regole e di che tipo funzionano
- 679 file di regole, 5000+ esecuzioni Claude Code su SWE-bench: regole casuali migliorano quanto quelle curate (+13,8 pp); le regole utili sono tutte negative ("non rifattorizzare codice non correlato"), quelle dannose tutte positive ("segui lo stile"); i tassi di successo restano stabili da 0 a 50 regole (https://arxiv.org/abs/2604.11088).
- Con 24 istruzioni verificabili impilate, da 1 a 20, il tasso di rispetto cala da ~96% fino al 20%, per conflitti a coppie; riscrivere il prompt in forma compilata recupera fino a +11 punti sui modelli deboli, nulla sui forti (https://arxiv.org/abs/2608.02639). Modelli: Sonnet 4.6, GPT-5-mini, Gemini 2.5 Flash.
- Risultati in tensione: il primo dice nessun degrado fino a 50 regole (compito: SWE-bench), il secondo degrado forte (compito: istruzioni di formato verificabili). Non confrontabili 1:1.

## Implicazioni per le candidate
1. Il problema dei sub-agenti è reale e va risolto con iniezione esplicita nel prompt del ruolo: nessuna eredità automatica da presumere.
2. Un digest breve e stabile è coerente con i dati: il valore sta nel priming e nelle regole negative; più testo non garantisce più aderenza.
3. La forma conta: privilegiare divieti ("mai X") e pattern con esempio breve; evitare liste lunghe di direttive generiche.
4. Il peso 40 dell'aderenza va misurato sul nostro caso, non assunto dagli articoli.

## Gate
- Affermazioni portanti: 6, con URL recuperato davvero: 5 (abstract arXiv ×2 letti per intero; docs Claude Code e Cursor solo da snippet di ricerca; issue GitHub da snippet)
- Contro-evidenza cercata per: "più regole degradano" → trovata (tensione D2) · non cercata per: "iniezione nel prompt batte retrieval a richiesta"
- Famiglie di fonti: 4 (docs Anthropic, docs Cursor/Devin, arXiv, GitHub issue)
- unknown dichiarati: se i figli `pi` eseguono il hook del vault (dal codice sì, mai provato); effetto sul nostro compito; articoli con modelli diversi dal nostro (Opus 4.6 su SWE-bench, non su pattern di stile)
