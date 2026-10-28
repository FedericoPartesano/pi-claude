Aggiornato: 2026-10-26 · fase 2

# Ricerca

Fonti: documentazione ufficiale Anthropic, recuperata il 2026-10-26.

## D1. Cosa fa scattare un `refusal` e quanto costa
- Sonnet 5.5, Opus 5.5 e gli altri modelli recenti hanno classificatori di sicurezza che rispondono 200 con `stop_reason: "refusal"` e `stop_details.category` (`cyber`, `bio`, `frontier_llm`, `reasoning_extraction`, `general_harms`, o `null`). https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
- `cyber`: «richiesta che potrebbe abilitare danno informatico, come malware o exploit; **anche lavoro di sicurezza benigno può far scattare la categoria**». Stessa fonte. Combacia con l'ipotesi del brief (lavoro su token/segreti di accesso remoto, `javap`, reverse).
- Un rifiuto prima di qualsiasi output non è fatturato per `cyber` e `general_harms`; lo è per `bio`, `frontier_llm`, `reasoning_extraction`. Un rifiuto a metà flusso fattura input e output già emessi. Stessa fonte.
- «Ritentare sullo stesso modello la stessa richiesta» è indicato come errore: va ritentata su un altro modello o cambiata. Stessa fonte, sezione "Common pitfalls".
- `reasoning_extraction`: scatta se un prompt chiede al modello di riportare il ragionamento nel testo. Il prompt di riassunto di Pi non lo fa (non verificato parola per parola).
- Il bridge oggi scarta `stop_details`: la categoria, che direbbe la causa, non viene registrata. **Da aggiungere al log** (vedi `90-ignoto.md`).

## D2. Cache e compattazione
- Prezzi cache: scrittura +25% (5 min), 2x (1 h), lettura 10% del prezzo base di input. https://platform.claude.com/docs/en/about-claude/pricing e https://claude.com/resources/articles/prompt-caching
- Claude Code su abbonamento chiede TTL di 1 ora per la conversazione principale, 5 minuti per «tutto il resto» (compattazione, sub-agenti). https://code.claude.com/docs/en/prompt-caching
- La compattazione di Claude Code ripete system prompt, tool e storia da riassumere, quindi **a cache calda legge il prefisso dalla cache** e costa «una frazione di quanto suggerisce la dimensione del contesto». Dopo una pausa oltre il TTL la storia è riletta senza cache. Stessa fonte, sezione "Compacting the conversation".
- Dopo la compattazione il turno successivo riscrive la cache solo per il riassunto, più corto. Stessa fonte.
- **Inferenza mia, non misurata:** Pi serializza la storia in un unico messaggio con un system prompt proprio (`compaction.ts:747`). Il prefisso è diverso da quello della conversazione, quindi non legge la cache: ogni compattazione di Pi pagherebbe l'intera storia (~120k) come input non in cache. Spiegherebbe le 35k di cacheWrite per compattazione viste nel pacchetto. Va verificato su `usage` della richiesta di riassunto.
- Cambiare modello o impostazioni che toccano il prompt di sistema invalida tutta la cache. Stessa fonte.

## D3. Gestione del contesto: cosa offre la piattaforma
- Strategie lato server: `clear_tool_uses_20250919` (svuota i risultati dei tool più vecchi oltre una soglia, default 100.000 token, `keep` 3 coppie, `clear_at_least`, `exclude_tools`) e `clear_thinking_20251015`. https://platform.claude.com/docs/en/build-with-claude/context-editing
- Il clearing dei tool **invalida il prefisso in cache**: va scelto un `clear_at_least` abbastanza grande da giustificare la riscrittura. Stessa fonte. Conferma il vincolo #r25 (non riscrivere il contesto già inviato) e dice quando conviene romperlo: a lotti grandi e rari, non a ogni turno.
- La compattazione lato server è indicata come strategia primaria per sessioni lunghe; il clearing per controllo fine. Stessa fonte.
- Le immagini nelle richieste hanno limiti propri di numero e dimensione (Claude Code cap sul totale, pagina "Accumulating many images"). Dettaglio non letto. Nessuna fonte trovata su come potare immagini vecchie.
- Non è raggiungibile col bridge: `claude -p` non espone `context_management`. Da verificare se il binario lo accetta (flag o impostazioni).

## Gate
- Affermazioni portanti: 9, con URL recuperato davvero: 9 (3 pagine lette per intero con ricerca testuale, 2 solo da estratti di ricerca: pricing e articolo cache)
- Contro-evidenza cercata per: ipotesi cyber (la pagina dice che anche lavoro benigno scatta; non c'è un caso che la smentisca) · non trovata per: effetto di `refusal` sul riassunto di altri agenti, benchmark di compattazione con cache
- Famiglie di fonti: 1 (documentazione Anthropic; nessuna fonte indipendente)
- unknown dichiarati: categoria vera del refusal del Mac; se la richiesta di riassunto di Pi legge la cache; se `claude -p` accetta `context_management`; peso delle immagini nella fatturazione; strategie di altri agenti (Aider, Codex, OpenCode) non ricercate qui, vanno in fase 3
