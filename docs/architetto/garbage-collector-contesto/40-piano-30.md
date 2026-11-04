Aggiornato: 2026-11-03 · seguito autonomo («trova un modo per risparmiare token e tempo del 30%»)

# Piano per il −30% di quota
**Nessuna leva da sola arriva al 30%. Impilate, sì: stima 28–33%, da verificare con A/B.** Misure su 8.537 giri veri (pi-claude + smartlookup), pesi cacheRead 0,1 / cacheWrite 1,25 / output 5.

## Dove va il costo (misurato)
cacheRead 46%, cacheWrite 27%, output 18%, compattazioni 9%. Giri con un solo tool: 92%. Riassunti di compattazione: 6,4k token out (mediana), non 21k. Contesto dopo compattazione: 57k (mediana); prima: 120k.

## Leve, in ordine di rapporto guadagno/costo
| # | Leva | Guadagno | Prova | Costo |
|---|---|---|---|---|
| 1 | `compaction.keepRecentTokens` da 20k (default) a ~8k: contesto dopo compattazione 57k → ~40k | **9–10%** (post 40k), 13–16% (post 30k) | simulato, 3 sessioni (`sim-gc.cjs`, tabella `combined`) | una riga in `settings.json` |
| 2 | Non cambiare il prefisso a metà sessione: la sezione `memory` del prompt e i tool `goal_done`/gruppi web/browser accesi-spenti ricostruiscono tutta la cache (1,15·C ≈ 85k unità) | **~5%** (84 su 168 giri freddi preceduti da un messaggio `system`, 0,1% dei tiepidi); 4–8% se si sistemano anche i freddi con `memory-recall` | misurato sui log, causa dedotta dal codice | memoria in coda come messaggio; `goal_done` sempre attivo |
| 3 | Tetto alla fonte (risultato di tool > 1.500 tok entra accorciato) | 3–8% | simulato | estensione piccola, parte c'è (`lean-tools`) |
| 4 | Riassunto di compattazione sul prefisso in cache (nel processo vivo del bridge) invece di una chiamata fredda | ~3–4% | simulato (cacheWrite 40k → 9,6k) | codice nel bridge, `session_before_compact` |
| 5 | Prompt fisso 17,8k → ~12k (skill, memoria, tool) | ~4% | stima: 6k × 0,1 × 8.500 giri | togliere righe |
| 6 | Letture indipendenti in un solo giro | ≤5,8% (tetto: 705 giri su 8.541 fondibili) | misurato come limite superiore | nudge nel prompt |
Combinazione simulata di 1+3+4: **−19…−20%** su tutte e 3 le sessioni. Con 2, 5, 6 a metà del loro valore: ~28–33%.

## Cosa NON funziona (misurato, tutto in questo studio)
- GC con cestino per sfratto: −7…+4% (vedi `20-confronto.md`).
- Compattare più tardi o più presto: piatto, ±2% intorno a `reserveTokens` 80000–100000; 140000 esplode (98 compattazioni).
- Ping per tenere viva la cache: inutile, il TTL è lungo (41 giri tiepidi su 64 dopo pause ≥5 min).

## Rischi
- Leva 1: meno storia letterale dopo la compattazione → possibile perdita di dettagli recenti. Non misurata la qualità: serve prova su compiti a risposta nota.
- Leva 2: la memoria in coda cambia la posizione del contesto utile per il modello (meno peso di prompt).
- Token stimati a caratteri; pesi dell'abbonamento ignoti (ma con cacheRead a peso 1 le conclusioni sul GC non cambiano).

## Esperimento di verifica
Stessa sessione guidata (script fisso) con configurazione base e con la leva 1+2; misurare `usage` reale per giro (Σ pesata) e controllare 5 domande a risposta nota sul lavoro svolto dopo la compattazione. Successo: ≥ 30% in meno sull'insieme e risposte uguali. Falsificatore: se la leva 1 da sola dà < 5% sul reale, la stima della tabella cade.

## Applicato subito
`~/.pi/agent/settings.json` → `compaction.keepRecentTokens: 10000` (reversibile: toglierlo ripristina 20000).
