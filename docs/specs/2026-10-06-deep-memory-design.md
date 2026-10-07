# Memoria profonda a richiamo (zero token se non serve) — design

Data: 2026-10-06 · Stato: approvato in chat · Evolve `docs/specs/2026-10-06-memory-dream-design.md` (memoria con tetto).

## Perché
La memoria con tetto (~1k token sempre in contesto) è corta: per stare nel tetto scarta ricordi. L'utente vuole una
memoria **completa e profonda** che **non consumi token**. I token si spendono solo per ciò che entra nel contesto,
quindi: conservare tutto su disco, richiamare per ogni richiesta solo i pochi ricordi pertinenti (come la memoria umana:
un indizio evoca ciò che serve).

## Criteri di accettazione
1. Costo fisso zero senza memoria (prima richiesta identica a oggi, ~3,6k token) e avvio di Pi non rallentato.
2. Richiesta estranea ai ricordi → **nessuna iniezione** (0 token).
3. Richiesta pertinente → al massimo 5 ricordi, **≤ 300 token**, iniettati **in coda alla richiesta** (non nel system
   prompt: la cache del prefisso resta valida).
4. Nella valutazione la memoria profonda rispetta le regole almeno quanto quella con tetto, iniettando in media meno token.
5. Archivio di 1.000 ricordi: richiamo < 100 ms dopo il caricamento del modello; ricordi giusti nei primi 5 (recall@5) ≥ 0,8.

## Architettura
- **Archivio** `<cwd>/.pi/memory/` (progetto) e `~/.pi/agent/memory/` (globale, isolabile con `PI_MEMORY_GLOBAL_PATH`):
  - `memories.jsonl`: `{id, type, text, pinned, confirmations, created, last, status: active|superseded, supersededBy?,
    entities: string[], source?}`; nessun tetto.
  - `vectors.json` (o binario): embedding per id, calcolato una volta alla creazione/modifica del ricordo.
  - Migrazione: se esistono `.pi/memory.md`/`memory-archive.md` (formato attuale) vengono importati.
- **Consolidamento** `/dream` (Haiku, invariato nel flusso: lookback a blocchi, segreti filtrati, proposta, approvazione):
  la proposta include `entities` per ogni ricordo; il codice aggiunge le entità deterministiche (percorsi, identificatori
  `camelCase`/`snake_case`, nomi di file). Contraddizioni → il vecchio diventa `superseded`. Deduplica come oggi.
  Nessun tetto: ciò che oggi va "oltre il tetto" resta attivo nell'archivio.
- **Oblio umano**: niente si cancella; la forza `strength = f(conferme, giorni dall'ultima conferma)` pesa nel punteggio
  (ricordi deboli più difficili da richiamare), `superseded` non viene mai iniettato (solo `/ricorda`).
- **Richiamo** a ogni richiesta (`before_agent_start`, solo se l'archivio esiste):
  - punteggio ibrido = semantica (coseno embedding prompt↔ricordo) + BM25 + associazioni (entità citate nel prompt, anche
    `@file`, e ricordi che condividono entità con i migliori: un passo di "attivazione diffusa") + forza;
  - soglia di pertinenza (taratura nei test): sotto soglia → nulla;
  - top ≤ 5 entro 300 token, restituiti come messaggio aggiunto in coda (custom message di `before_agent_start`), con
    un'intestazione breve tipo "Ricordi pertinenti (da sessioni precedenti):";
  - nucleo sempre presente: solo i 📌, con un tetto minimo (~100 token), nel system prompt (stabile, quindi in cache).
- **Embedding locale**: libreria `@huggingface/transformers` (onnxruntime su CPU) con un modello **multilingue** piccolo
  quantizzato (es. `Xenova/multilingual-e5-small` o `Xenova/paraphrase-multilingual-MiniLM-L12-v2`: scegliere il più
  piccolo che funziona bene in italiano), cache del modello in `~/.cache`; caricato **dopo** `session_start` in
  background (non blocca l'avvio); se non è pronto o fallisce → richiamo solo BM25 + associazioni (mai errori visibili).
- **Codice**: dipendenze in un pacchetto `pi-memory/` (package.json, node_modules); `extensions/memory.ts` resta il punto
  d'ingresso (stesso percorso per `install.sh`, `settings.json` e valutazione). Funzioni pure testate senza modello
  (punteggio, soglia, budget, entità, forza, migrazione) e un test che usa un embedder finto deterministico.
- **Modalità per la valutazione**: `PI_MEMORY_MODE=capped|deep` (default `deep`); `capped` = comportamento attuale.
- `/ricorda <query> [--use]`: stesso motore, include anche i `superseded` marcati come tali.

## Valutazione
- **Offline (zero token)**: archivio sintetico di 500–1.000 ricordi su ~30 argomenti con ~20 "ricordi bersaglio";
  query pertinenti e query estranee: recall@5, falsi positivi sulle estranee, token iniettati, latenza.
- **Empirica (≤ 10 compiti)**: fixture + sessioni (le 6 regole sepolte tra molte altre), bracci `none` / `capped` /
  `deep`, compiti pertinenti e 2 estranei; metriche: regole rispettate, token iniettati per richiesta, token totali,
  tempo. Risultati in `eval/MEMORY-REPORT.md` (nuova sezione).
