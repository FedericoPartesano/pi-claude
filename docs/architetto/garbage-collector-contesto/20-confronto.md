Aggiornato: 2026-11-03 · fase 3 (ridotta, dichiarato)

# Confronto e misura
## Repo (limite dichiarato: 3 profili su 6 del profilo «profondo»)
| | opencode | OpenHands SDK | Letta | the-complexity-trap |
|---|---|---|---|---|
| Idea | riassunto in anticipo, scambiato a soglia, immagini potate a gradini | condenser a numero di eventi, rapporto minimo | memoria a due tier | masking vs riassunto, benchmark |
| Licenza | MIT | MIT | Apache-2.0 | MIT |
| Salute | 221k★ | 1,3k★ | 25k★, push 2026-10-18 | 20★, ultimo push 2025-11 |
| Letto | profilo in `../gestione-contesto-pi/20-repo/` | idem | **non letto**: HEAD senza codice | solo paper |
Nessun repo di riferimento implementa un cestino con promozione per numero di richiami (ricerca per codice e per tema: muta).

## Misura: replay offline di 3 sessioni vere (`sim-gc.cjs`)
Costo in unità di un token di input (cacheRead 0,1, cacheWrite 1,25, output 5), compattazione = 217k unità, token a 2,5 caratteri. Calibrazione: compattazioni simulate 5, 7, 12 contro 7, 12, 16 reali.

| Sessione | Giri | Quota tool | Rilanci identici | GC per sfratto, miglior config | Tetto alla fonte (1.500 tok) |
|---|---|---|---|---|---|
| pi-claude 14 ott | 418 | 39% | 0 | **+4%** quota, −5% contesto medio | +8% |
| smartlookup 12 ott | 822 | 57% | 22 (7% dei tool) | **+1%** | +3% |
| pi-claude 12 ott | 1066 | 54% | 1 | **0%**, peggio fino a −7% | +6% |
Con cinque configurazioni (`keep` 4–10, `minFree` 15–45k, `start` 60–100k) il GC varia da −7% a +4%. Le compattazioni scendono (12 → 7–9) ma ogni sfratto riscrive la cache quanto una compattazione.

## Perché: formula del pareggio
Sfrattare X token con contesto C costa ~1,25·C una volta e risparmia 0,1·X a ogni giro successivo: pareggio dopo T > 12,5·C/X giri. Con C = 100k e X = 30k: T > 42 giri; la vita tra due compattazioni è 50–80 giri. Il guadagno è un decimale, la soglia è 30%.

## Il segnale «richiami» non esiste nei dati
Rilanci dello stesso risultato: 1 su 1066 giri, 0 su 418, 22 su 822. Con 0–5 richiami simulati su sessioni da 400–1000 giri, né la soglia di promozione né N si possono calibrare: il meccanismo di promozione non ha dati che lo sostengano.
Limite: il baseline non può vedere i richiami che il GC causerebbe (il modello non rilancia ciò che ha davanti). Sensibilità: con il 25% dei risultati tagliati da riprendere intero il guadagno scende di 1–2 punti.

## Limiti della misura (dichiarati)
Token stimati a caratteri, non misurati; pesi dei prezzi dell'abbonamento ignoti; nessuna misura di qualità (compiti a risposta nota non eseguiti: non serve, la quota è già fail).

## Sensibilità al prezzo di cacheRead
Rifatto con cacheRead = 0,5 e 1,0 (come se la quota contasse la lettura di cache per intero): il GC resta tra −5% e +5%. Il contesto medio scende al massimo del 5%: il contesto sale sempre fino alla soglia di compattazione (~120k) e la parte sfrattabile è una frazione di ciò che lo riempie. Il risultato non dipende dai pesi.
