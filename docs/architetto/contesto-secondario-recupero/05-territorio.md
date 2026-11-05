# Territorio: memoria a livelli e recupero dalla storia compattata per agenti LLM
Aggiornato: 2026-11-04 · fase 1b

Fonti consultate (2026-11-04): arXiv 2310.08560 MemGPT (letto); doc Anthropic Prompt caching https://platform.claude.com/docs/en/build-with-claude/prompt-caching (letta, sezione «What invalidates the cache»); arXiv 2606.04329 memory poisoning (solo abstract letto); risultati di ricerca (non letti per intero): Letta (letta.com/blog/agent-memory), mem0 benchmark 2026, Microsoft Learn memory poisoning, OWASP ASI06 (citato da terzi), cookbook Anthropic context engineering.

## 1. Concetti e vocabolario
- Livelli: core (in contesto), recall (storia ricercabile), archival (lungo termine, vettoriale) — `coperta` (il brief ha archivio + `richiama`; non distingue recall e archival) — Letta/MemGPT
- «Virtual context management»: spostare dati tra livelli con chiamate di funzione dell'agente — `coperta` — arXiv 2310.08560
- Memoria scritta dall'agente (core/archival) contro storia registrata automaticamente: il nostro archivio è solo la seconda — `non coperta` (decidere se serve anche scrittura attiva dal modello)

## 2. Pattern noti
- Paging a livelli con ricerca invocata dal modello (MemGPT): è `richiama` — `coperta`
- Iniezione automatica prima del turno (RAG sulla storia) — `coperta` (candidata ibrida)
- Context editing server-side / tool-result clearing, memory tool — `differita (claude -p non espone context_management, vedi gc-contesto)`
- Anti-pattern: recupero aggressivo; i testi dicono che più si scrive e si recupera, più si è sfruttabili — `coperta` (Q11, tetto 1500 caratteri) — arXiv 2606.04329 (abstract)

## 3. Trade-off noti
- Recupero contro riassunto: richiamo esatto contro costo e rumore — `coperta` (banco dump)
- Precisione contro richiamo dell'iniezione automatica: l'estratto sbagliato costa quanto il mancato — `coperta` (scenario «precisione»)
- Costo della cache: modificare le definizioni dei tool invalida tools, system e messages; cache read costa 0,1x (0,05x su Sonnet 5.5 e Opus 5.5), write 1,25x — `coperta` (vincolo costo) — doc Anthropic. Conferma l'ipotesi del +3,8% (tool `richiama` acceso a metà sessione) come causa plausibile, non dimostrata.
- Iniettare nel messaggio dell'utente invece di cambiare i tool o il system prompt mantiene intatta la cache del prefisso — `coperta` (già così) — doc Anthropic
- I pesi usati nei banchi (cacheRead 0,1) non valgono per i modelli 5.5 (0,05): il rapporto di costo cambia — `non coperta`

## 4. Modi di fallimento noti
- Estratto sbagliato o superato iniettato come vero — `coperta` (Q14)
- Poisoning: testo ostile in un vecchio output viene riproposto e ottiene fiducia; le difese standard contro la prompt injection non lo coprono (MPBench) — `coperta` (Q11), da misurare
- Il modello non chiama mai lo strumento di recupero (osservato con haiku) — `coperta`
- Deriva dell'indice: indice ricalcolato a ogni turno, latenza che cresce con la sessione — `coperta` (Q13)

## 5. Attributi di qualità (ISO 25010)
- Efficienza prestazionale (costo, latenza) — `coperta` (pesi 4 e vincolo 50 ms)
- Idoneità funzionale (richiamo corretto) — `coperta` (peso 5)
- Sicurezza — `coperta` (Q11), senza scenario con peso — `non coperta` come scenario misurabile
- Affidabilità (`/compact`, `/resume`, fork) — `coperta` in parte (Q12), fork e rami `differita (fuori perimetro)`
- Usabilità (visibilità per l'utente) — `coperta` (Q15)
- Portabilità (Windows, macOS, WSL) — `coperta`

## 6. Standard, normative, convenzioni
- OWASP Agentic AI Top 10, ASI06 «Memory and Context Poisoning» — `non coperta` (fonte secondaria, da verificare sul testo OWASP)
- Privacy: segreti nell'archivio — `coperta` (Q16, nessuna redazione)

## 7. Strumenti ed ecosistema
- Letta/MemGPT, mem0, memory tool Anthropic, embedder locale `pi-memory/src/embed.ts` — `coperta` (profili in fase 3)
- Benchmark: LoCoMo, LongMemEval (5 abilità, compresi aggiornamenti di conoscenza e astensione), BEAM, STATE-Bench (task-level) — `non coperta`: il nostro banco `dump` è sintetico; capire se riusare LongMemEval/BEAM o le loro metriche (astensione, aggiornamento)
- Cache diagnostics API per vedere cosa ha invalidato la cache — `non coperta` (via `claude -p` forse non raggiungibile)

## 8. Fonti e persone autorevoli
- MemGPT/Letta (Packer et al.), Anthropic context engineering, mem0 (parte interessata: i suoi benchmark sono di un venditore) — `coperta`; candidati per `RESOURCES.md` in fase 2

## 9. Controversie aperte
- Riassunto contro recupero: i benchmark di venditori danno punteggi >90% non confrontabili tra loro («nessun benchmark dà un punteggio universale», mem0) — `non coperta`
- Se serve la memoria scritta dall'agente o basta la storia registrata — `non coperta`

## Non coperte → decisione di Federico (2026-11-04, raccomandazioni accettate)
1. Memoria scritta dal modello — differita (secondo studio; la storia registrata basta al risultato atteso)
2. Pesi di costo dei modelli 5.5 (cacheRead 0,05x) — affrontare: ricalcolo dei banchi con entrambi i pesi, senza nuovi run
3. Riuso di LongMemEval/BEAM — affrontare in piccolo: solo metriche di astensione e aggiornamento nel banco `dump`
4. Scenario di sicurezza (poisoning), peso 3, non portante — affrontare
5. Lettura per intero di MPBench e OWASP ASI06 — affrontare in fase 2
6. Cache diagnostics via `claude -p` — differita (inutile se non passa dal bridge)
