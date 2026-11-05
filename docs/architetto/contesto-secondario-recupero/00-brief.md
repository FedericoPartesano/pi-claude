# Contesto secondario: recupero, profondità e costo
Aggiornato: 2026-11-04 · fase 1 · profilo: profondo · tema: contesto-secondario

## Problema e contesto
Pi compatta la sessione e il riassunto perde i dettagli esatti. `extensions/archivio.ts` tiene la storia compattata consultabile (tool `richiama`, recupero automatico, BM25). Misurato il 2026-11-04 (`eval/ab/REPORT.md`): su dati non rileggibili da disco, 18/18 corrette con archivio contro 1/18 del default Pi, a −16,5% di costo; sul carico di sole letture +3,8%. Il recupero automatico scatta solo con almeno 2 identificatori nella domanda; haiku non chiama `richiama` da solo. Se non si fa nulla: il contesto utile resta quello vivo, e il recupero funziona solo per domande con codici o nomi di file.
Decisioni già prese: GC con cestino e promozione non costruito (`docs/architetto/garbage-collector-contesto/`); non riscrivere il contesto già inviato (+19,6%, #r25).

## Risultato atteso
A parità di token pesati, in una sessione con 5 o più compattazioni il modello risponde correttamente ad almeno il 90% delle domande su dati usciti dal contesto vivo, anche senza identificatori nella domanda.

## Modo di fallimento
Entro una settimana di uso, misurato con il banco: il costo supera il default Pi su un carico di sole letture, oppure più del 10% dei recuperi automatici inietta un estratto sbagliato.

## Vincoli duri
- Stack: TypeScript eseguito da Node ≥ 22.19, estensione Pi; nessuna dipendenza nuova; embedder locale esistente `pi-memory/src/embed.ts` ammesso.
- Piattaforme: Linux, macOS, WSL (e Windows). Pi non segue i symlink negli import relativi; le estensioni non importano `pi-tui`.
- Costo fisso di prompt minimo: iniezione ≤ 1500 caratteri per turno, zero quando non scatta; nessun tool acceso fuori dall'archivio.
- Latenza del recupero ≤ 50 ms per turno, con indice incrementale; oltre, si salta in silenzio.
- Licenze per codice copiato: MIT/Apache/BSD.
- Prove nel TUI reale: le fa l'utente.

## Scenari di qualità
| Scenario | Misura | Peso | Portante |
|---|---|---|---|
| Recupero di dati non rileggibili | % corrette dopo 5 compattazioni | 5 | sì |
| Costo | costo pesato ≤ default sul carico long | 4 | sì |
| Precisione dell'iniezione | % di iniezioni con l'estratto giusto | 3 | no |
| Profondità | % corrette a 10 compattazioni | 3 | no |
Il costo è un vincolo; l'ordine degli obiettivi è: 1 recupero senza identificatori, 2 profondità.

## Ipotesi da smontare e candidata dichiarata
- Candidata dichiarata: recupero ibrido (iniezione automatica quando sicuro, `richiama` altrimenti), BM25 più embedder locale.
- Ipotesi: il +3,8% sul carico di sole letture viene da `richiama` acceso a metà sessione (cache del prefisso riscritta). Da verificare, non assunta.
- Ipotesi: Sonnet chiama `richiama` da solo, haiku no. Una prova approvata.

## Riferimenti amati / odiati
Nessuno indicato dall'utente. Da cercare nelle fasi 2–3: memoria a livelli (MemGPT/Letta), retrieval su storia di sessione, context editing Anthropic.

## Fuori perimetro e anti-obiettivi
- Fuori: GC con cestino e promozione; riscrittura del contesto già inviato; il 30% di risparmio come obiettivo; sessioni passate (restano a `/dream` e `/ricorda`); fork e rami dell'albero (non coperti).
- Anti-obiettivo: un recupero che aumenta il costo o inietta testo che il modello esegue come istruzione.
- Politiche accettate: estratto marcato come dato citato, mai ruolo utente; a pari rilevanza vince la voce più recente con il numero del turno; una riga di stato («archivio: 2 estratti da turno 14») e `/archivio` per l'ultimo estratto; nessuna redazione dei segreti, solo la garanzia di non scrivere fuori dal file di sessione; `/compact` e `/resume` verificati, archivio sempre ricalcolato dal ramo corrente.

## Decisioni già prese (ADR letti)
Nessun ADR nel repo (`docs/adr/` non esiste). Decisioni in `~/.architetto/conoscenza/decisioni.md` (gc-contesto) e `docs/architetto/garbage-collector-contesto/README.md`.
