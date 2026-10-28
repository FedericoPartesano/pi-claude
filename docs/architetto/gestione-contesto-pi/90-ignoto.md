Aggiornato: 2026-10-26

# Ignoto

- Il Mac usa lo stesso `reserveTokens` (80000) e la stessa finestra (200k)? La sua `settings.json` non è nel pacchetto del bug.
- Perché il riassunto resta a 16–18k token a ogni compattazione? Servono le voci `compaction` e il prompt di riassunto di Pi.
- (Ristretto, non risolto) Cosa nel contesto fa rispondere `refusal` alla chiamata di riassunto delle 07:43:50? Non è nel pacchetto (finisce all'ultima compattazione riuscita, 07:17).
- `context-tiers` è scattato sul Mac? Non verificato.
- Quanta quota consuma davvero una compattazione ogni 5 minuti? Stima non misurata.
- Quanto del contesto sono riletture di file? Da rifare escludendo le immagini.
- `extensions/caveman.ts` partecipa al loop di compattazione?
- Quanto costa davvero un'immagine nella fatturazione con `claude -p`? La stima 760 token l'una non è verificata.
- Dopo quanti giri un'immagine ancora serve? Un'immagine letta una volta resta nel contesto fino alla compattazione.
- (risolto, 05-territorio §6) Il riassunto di Pi non legge la cache (cacheRead 0 su 10).
- Perché l'output del riassunto è 21–28k se il testo salvato è 16–18k? Ragionamento del modello non salvato: da verificare.
- (ricerca) `stop_details.category` del refusal: il bridge la scarta. Aggiungerla al log del refusal.
- (ricerca) `claude -p` accetta `context_management` (clear_tool_uses)? Altrimenti la leva lato server non è usabile.
- (ricerca) Ritentare il riassunto sullo stesso modello dopo un refusal è sconsigliato dalla documentazione: Pi lo fa a ogni giro.
- (repo) Anticipare il riassunto (opencode) costa output extra a ogni salita di soglia: misurare su sessione tipo.
- (repo) Pi può inviare il riassunto con il prefisso della conversazione (per leggere la cache)? Dipende dal codice di compattazione di Pi, non dal bridge.
- (repo) Dolori di gemini-cli e OpenHands, Scorecard e advisory non esaminati.
- (tradeoff) Ricalibrare `sim-compattazione.js`: la base prevede 7 compattazioni, le reali sono 10; correggere la crescita per giro.
- (tradeoff) Peso reale dell'output nella quota dell'abbonamento (ipotesi ×5): senza, le leve sul riassunto non sono dimensionate.
- (tradeoff) Pi può mandare il riassunto sul processo `claude` persistente con lo stesso prefisso? (leva D)
- (tradeoff) Il riassunto con tetto 8k e i risultati dei tool tagliati perdono informazioni utili? Compiti a risposta nota.
- (tradeoff) Seconda sessione di riferimento: ancora da scegliere; la simulazione va rifatta su di essa.
