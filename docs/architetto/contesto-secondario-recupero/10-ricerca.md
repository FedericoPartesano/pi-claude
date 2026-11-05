# Ricerca: costo di cache, sicurezza del recupero, benchmark di memoria
Aggiornato: 2026-11-04 · fase 2

## R1. Costo: che cosa invalida la cache e quanto costa
- Gerarchia `tools → system → messages`: cambiare le definizioni dei tool invalida tutta la cache; cambiare `tool_choice` solo i messaggi. https://platform.claude.com/docs/en/build-with-claude/prompt-caching («What invalidates the cache»)
- Prezzi: scrittura 5 min 1,25x, 1 h 2x, lettura 0,1x; per Sonnet 5.5 e Opus 5.5 la lettura è 0,05x. Stessa pagina, «Pricing».
- Con i modelli che supportano `inline-tools-2026-09-15` si può aggiungere un tool a metà conversazione senza toccare `tools` (blocco `tool_addition` in un messaggio di sistema): la cache resta valida. Stessa pagina. **Raggiungibile via `claude -p`: unknown.**
- Implicazione per noi: l'iniezione nel messaggio dell'utente non tocca il prefisso. L'ipotesi «+3,8% = `richiama` acceso dopo la prima compattazione» è coerente con la doc ma non provata; si prova accendendo `richiama` dall'inizio.

## R2. Sicurezza: il recupero dalla storia come canale di poisoning
Fonte: arXiv 2606.04329 v2 (Huawei Canada), HTML letto per i primi 30.000 di 77.867 caratteri. https://arxiv.org/html/2606.04329v2
- Contenuto esterno (output di tool, file) rientra nel contesto e viene trattato come fidato; «nessun meccanismo robusto di provenienza» (§1). Vulnerabilità V-M1 (confine istruzione/dato) e V-M2 (attribuzione della fonte).
- Canali di scrittura: C3 «compaction-driven» (la compattazione scrive in memoria; V-P2 compattazione senza filtro di fonte; V-S3 soglia manipolabile).
- ASR medio 50,46%, RSR 41,05% su OpenClaw e HERMES (GPT-OSS-120B). Gli agenti che scrivono e recuperano in modo più aggressivo sono più sfruttabili; le difese contro la prompt injection coprono solo in parte (§1, §4).
- **Differenza dal nostro caso:** l'archivio non scrive in una memoria persistente tra sessioni; rimette in contesto testo già presente nella stessa sessione. Il rischio nuovo è che un'istruzione vista in un vecchio output, ormai fuori dal contesto vivo, ritorni con l'autorità dell'«estratto dalla storia». Lo studio non misura questo caso: da misurare con il nostro banco.
- Il paper cita LoCoMo/LongMemEval come benchmark benigni, senza componente avversaria.
- Non letto: risultati per difesa (§4.3), appendici. **unknown.**

## R3. Benchmark e architetture
- LongMemEval (ICLR 2025): 500 domande, 5 abilità (estrazione, ragionamento multi-sessione, temporale, aggiornamento delle conoscenze, astensione); gli assistenti commerciali e gli LLM a contesto lungo perdono il 30% di accuratezza su storie lunghe; propone pipeline indicizzazione → recupero → lettura, con decomposizione per sessione, espansione delle chiavi con fatti e query espansa con il tempo. https://arxiv.org/abs/2410.10813 (letto solo l'abstract).
- MemGPT (arXiv 2310.08560): gestione a livelli con chiamate di funzione dell'agente e interrupt; è il modello di `richiama`. https://arxiv.org/abs/2310.08560 (abstract).
- Implicazione: le metriche da riusare sono astensione («non trovato» quando il dato non c'è) e aggiornamento (vince il più recente). Nel nostro banco manca un caso di astensione e uno di aggiornamento.
- Benchmark di venditori (mem0: 92,5 LoCoMo, 94,4 LongMemEval) non confrontabili: non usati.

## Gate
- Affermazioni portanti: 8, con URL recuperato davvero: 8 (doc cache letta per intero, paper poisoning parziale, due abstract arXiv, pagina OWASP solo introduzione)
- Contro-evidenza cercata per: «il recupero automatico costa di più» (nessuna fonte, solo i nostri banchi) · non trovata per: «il recupero dalla storia è un canale di poisoning» (il paper tratta memorie persistenti, non la storia di sessione)
- Famiglie di fonti: 4 (Anthropic, Huawei/arXiv poisoning, LongMemEval, MemGPT); OWASP ASI06 non verificato
- unknown dichiarati: testo di OWASP ASI06; difese misurate in MPBench; supporto di `tool_addition` via `claude -p`; risultati numerici di LongMemEval per recupero contro contesto lungo; costo reale dei modelli 5.5 nel nostro abbonamento
