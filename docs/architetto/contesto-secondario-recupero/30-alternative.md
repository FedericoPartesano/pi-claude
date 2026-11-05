# Alternative e tradeoff
Aggiornato: 2026-11-04 · fase 4

## Candidate
Stesso schema per tutte. Base comune: l'archivio grezzo di `extensions/archivio.ts` (nessun sfratto, nessuna riscrittura del contesto già inviato); cambia **come si trova** il chunk giusto.

### A (dichiarata) — Ibrido lessicale + vettoriale
- Invarianti: chunk grezzi (nessun fatto riscritto da LLM); RRF k=60 tra BM25 e coseno dell'embedder locale; iniezione solo sopra soglia, estratto marcato come dato citato, ≤1500 car.; `richiama` altrimenti.
- Seme minimo: indice vettoriale incrementale sui chunk, calcolato dopo la compattazione in background (`pi-memory/src/embed.ts`, worker); se l'embedder non è pronto, solo BM25.
- Stato: file di sessione Pi (verità) + indice in memoria, ricostruito dal ramo corrente.
- Evolve: soglie tarate dal banco; riordino selezionabile come in hindsight.
- Da: hindsight (`fusion.py:29`, `memory_engine.py:794`), claude-mem (degrado, `HybridSearchStrategy.ts:89`).

### B — Solo lessicale esteso
- Invarianti: come A, ma nessun embedder: BM25 con lemmatizzazione/prefissi per l'italiano, query = coda del prompt (`prepared_context.py:71`), soglia a più livelli (identificatori; termini rari condivisi), tetto 1500 car. con rapporto sul taglio (`ContextBuilder.ts:349`).
- Seme minimo: `tokens()` con normalizzazione + una regola «termine raro» in `autoRecall`.
- Stato: in memoria, nessun file nuovo. Evolve: stessa pipeline di oggi.
- Da: mem0 (`main.py:68`), powercontext, claude-mem.

### C (emersa) — Mappa nel riassunto
- Invarianti: nessuna iniezione automatica; alla compattazione l'estensione aggiunge al riassunto 5–10 righe «cosa c'è in archivio» (file letti, comandi, etichette) così il modello sa che cosa richiamare e `richiama` serve senza identificatori.
- Seme minimo: handler `session_before_compact` che produce il riassunto (`agent-session.ts:2441`, `result.compaction`).
- Stato: nel riassunto (testo) + archivio. Evolve: la mappa cresce con le compattazioni, rischio di gonfiare il riassunto.
- Da: nessun repo la fa; idea nata dal fatto che haiku non chiama `richiama`.
- Vincolo trovato: `extensions/caveman.ts:90` usa già `session_before_compact` e un solo risultato vince: serve coordinamento.

## Verdetti (filtri)
Prove disponibili in questa corsa: banco `dump` con identificatori (`eval/ab/REPORT.md`: archivio 18/18 contro 1/18, −16,5%); banco `long` (+3,8%). Nessuna misura esiste senza identificatori né oltre 2 compattazioni.

| Candidata | Recupero senza identificatori (5, portante) | Costo ≤ default su long (4, portante) | Precisione iniezione (3) | Profondità 10 compattazioni (3) | Sicurezza: istruzione piantata (3) |
|---|---|---|---|---|---|
| A | unknown (retrieval offline su domande parafrasate: recall@3 BM25 contro BM25+coseno) | unknown (l'archivio oggi dà +3,8%: serve il braccio `richiama` acceso dall'inizio; l'indice vettoriale aggiunge CPU, non token) | unknown (set di 50 prompt con etichetta giusta/sbagliata) | unknown (dump con 5 e 10 compattazioni) | unknown (banco con istruzione piantata) |
| B | unknown (stesso retrieval offline) | unknown (come A) | unknown (stesso set) | unknown | unknown |
| C | unknown (il modello deve chiamare `richiama`: haiku non lo fa; prova Sonnet) | fail probabile ma non misurato → unknown (righe fisse nel riassunto a ogni compattazione) | n/a (nessuna iniezione) | unknown (la mappa cresce) | unknown |

Nessuna cella `pass` o `fail` sugli scenari portanti: l'unica misura esistente copre il caso con identificatori, che il brief ha già come base.

## Sopravvissuti ed esclusi
Nessun sopravvissuto: A, B, C hanno `unknown` su scenari portanti. Nessun critico lanciato: la critica incrociata si fa sui sopravvissuti, e senza misure sarebbe opinione.

## Raccomandazione
**Il controllo da eseguire, non una candidata.** Poi, se il controllo non decide da solo, A. Controlli in ordine di costo:
1. **Retrieval offline senza LLM** (costo di token zero): 30–50 domande parafrasate, senza identificatori, su archivi veri (sessioni in `~/.pi/agent/sessions`); misura recall@3 di BM25 attuale, BM25 esteso (B) e BM25+coseno RRF (A). Decide A contro B.
2. **Braccio `richiama` acceso dall'inizio** sul banco `long` (3 run haiku): spiega o smentisce il +3,8%. Decide se il costo è un vincolo rispettabile per A e B.
3. Prova Sonnet su `dump` (già approvata): decide se C ha senso.

## Trade-off ceduti (se si sceglie A)
Un modello locale da centinaia di MB e CPU in background; una dipendenza dal caricamento lento (l'embedder può non essere pronto: si degrada a BM25).

## Falsificatore
A è sbagliata se, sul retrieval offline, il coseno non porta recall@3 almeno 15 punti sopra B, o se più del 10% delle iniezioni è sbagliato.

## Difesa
- «L'archivio grezzo evita fatti inventati» → mem0 #4956, #7283 (`20-repo/mem0.md`).
- «Ibrido con RRF è la prassi» → `fusion.py:29` (`20-repo/hindsight.md`); non è prova che funzioni da noi: verdetto unknown.
- «Il costo di claude-mem viene dall'LLM nel percorso» → claude-mem #4965, #5023.

## Rischi e unknown residui
- Pesi 0,05 (modelli 5.5) non ricalcolati.
- `claude -p` e `tool_addition`: non verificato.
- C confligge con caveman su `session_before_compact`.
- Il banco `dump` è sintetico (hex): il retrieval offline su sessioni vere è più rappresentativo.

## Esito dei controlli (2026-11-04) — dettaglio in `eval/ab/REPORT.md`
- Controllo 1 (retrieval): senza identificatori nessun metodo supera 0,54 hit@3 poolato; l'ibrido porta hit@1 da 0,28 a 0,40 ma hit@3 resta 0,52 (pari a BM25). Il vantaggio dell'ibrido sul falsificatore (≥15 punti su B in recall@3) **non c'è**: A cade su questo criterio. Lo stemming (B) vale +2 punti: trascurabile. Il tetto del recupero è ~0,5 con chunk da 900 car., sotto il 90% del brief.
- Controllo 2 (costo): D ≈ B (+3,5% contro +3,8%): non è la riscrittura della cache. Tool da solo +2,5%, auto-recall ~+1,3%. Lo scenario «costo ≤ default su long» è `fail` per A, B e C-come-richiama, a parità di meccanismo; resta valido il caso con dati non rileggibili (−16,5%).
- Controllo 3 (Sonnet su dump): 0 chiamate a `richiama`, A 0/6 contro B 6/6 grazie al solo auto-recall. C non ha supporto.
- Conseguenza: nessuna candidata sopravvive; il collo di bottiglia è la granularità/qualità del recupero (chunk, domande vaghe), non il tipo di indice. Prossima leva da misurare: chunk più piccoli o per voce, riordino, o richiamo guidato dal modello (non provato).
- Controllo 4 (chunk, 2026-11-04): dimensione 200–20000 car. non cambia il recupero BM25 (hit@3 rigido 0,12–0,16). 450 car. = stesso risultato di 900 con ~47% di testo restituito in meno (1385 contro 2611 car.): leva di costo dell'estratto, non di qualità. Resta aperto se il giudizio poolato o l'ibrido cambino con 450.
- Controllo 5 (riformulazione con LLM, 2026-11-04): hit@3 poolato 0,78 (BM25+e5 su domanda + 3 riscritture) contro 0,50–0,52 di tutti i metodi senza LLM; hit@1 0,52 contro 0,24–0,38. **Corregge la conclusione precedente**: il tetto ~0,5 era dei metodi senza riscrittura, non del recupero. Nuova candidata D: ibrido + riscrittura. Vincolo da verificare: LLM nel percorso di recall è il dolore principale di claude-mem/hindsight (#4965, #6306) → costo in token e latenza (>50 ms: va fuori dal vincolo del brief per l'iniezione automatica; può servire solo dentro `richiama` o in background).
- Costo della riscrittura (2026-11-04): ~2.066 token pesati per chiamata con i flag del bridge (14% di un giro medio), ~57.630 con `claude -p` di default. Latenza ~15 s. Quindi: fattibile solo fuori dal percorso sincrono (dentro `richiama` o a richiesta), non per l'iniezione automatica a ogni turno.
- Controllo 6 (end-to-end senza identificatori, ≥5 compattazioni, 2026-11-04, `eval/ab/REPORT.md` §9): A 13/18, B 5/18; il modello non chiama mai `richiama`, il recupero automatico lessicale non scatta su parafrasi. Retrieval e5 su tutto l'archivio: hit@3 6/6 (una sessione). **Candidata D' (da decidere):** recupero automatico basato su e5 (embedding dei chunk in background dopo la compattazione, query ~25 ms, iniezione ≤1500 caratteri sopra soglia di similarità); la riscrittura LLM non serve (sulle domande vere non aiuta, §7). Falsificatore: dopo l'implementazione, <90% di risposte corrette nel modo `noid` (≥3 run), oppure iniezioni sbagliate >10% sul banco, oppure costo pesato oltre il +0% di A.
