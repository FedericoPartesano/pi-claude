Aggiornato: 2026-11-03 · fase 4

# Alternative
### A — GC completo (idea dell'utente)
- Invarianti: ciò che è vecchio va nel cestino; richiamo → torna nel contesto; N richiami → fisso; altrimenti eliminato.
- Seme minimo: estensione che a blocchi sostituisce i vecchi risultati con segnaposto (`context-tiers`), più indice del cestino su disco, richiamo, contatore, promozione.
- Stato: indice su disco (il transcript c'è già). Evolve: soglie `keep`, `minFree`, `promote`, `expire`. Prende da: MemGPT (tier), Anthropic `clear_tool_uses` (blocchi, `clear_at_least`).
### B — GC minimo: solo sfratto a blocchi con richiamo per rilancio
- Come A, senza cestino né promozione: il segnaposto dice come rifare (ripeti il comando); un rilancio dello stesso comando è già un richiamo. Quasi tutto esiste in `extensions/context-tiers.ts`.
### C — Tetto alla fonte
- Un risultato di tool oltre un limite entra già accorciato (testa+coda), niente sfratto, niente riscrittura cache. Prende da: lean-tools, opencode.
### D — Niente GC: lasciare il contesto com'è e agire altrove
- Compattazione frugale e anticipata (studio `gestione-contesto-pi`), modello più piccolo per il riassunto, abitudini d'uso (sessioni più corte, `/new` più spesso).

## Esito di tradeoff
### Raccomandazione
**La raccomandazione contraddice l'idea iniziale: non costruire il GC con cestino e promozione.** Nel replay di tre sessioni vere nessuna variante raggiunge il 30% (da −7% a +8%) e la promozione per numero di richiami non ha dati. Il pezzo che resta utile, il tetto alla fonte (C) e `context-tiers` (B), è già nel repo e vale 2–8%.

### Verdetti
| Candidata | Quota (40, portante) | Qualità (30) | Affidabilità (20) | Manutenzione (10) |
|---|---|---|---|---|
| A | fail(−7%…+4% simulato, soglia 30%) | unknown(compiti a risposta nota non eseguiti: inutile con la quota già fail) | fail(richiami: nuovo tool e contatori, la staleness va invalidata) | fail(indice, soglie, tool) |
| B | fail(0…+4%) | unknown(stesso controllo) | pass(nessun tool in più, richiamo = rilancio) | pass(esiste già) |
| C | fail(+1…+8%) | pass(il modello può rilanciare; l'evidenza di masking è favorevole: Complexity Trap) | pass | pass |
| D | unknown(nessuna misura in questo studio: serve lo studio precedente, −14,5…−28,8% simulato) | pass(contenuto invariato) | unknown | pass |

### Sopravvissuti ed esclusi
- Esclusa A: fail su quota portante. Esclusa B: fail su quota portante. Esclusa C: fail su quota portante (utile come ottimizzazione, non come soluzione del 30%).
- D resta come unica via aperta, **ma è già lo studio precedente**, non questo.
- Nessun sopravvissuto: nessun critico lanciato (il profilo `profondo` ne prevede 3; costo risparmiato, dichiarato).

### Critica incrociata (fatta da me, nessun subagente)
- Obiezione più forte alla simulazione: i token sono stimati a caratteri e sessioni di 400–1000 giri dove ~40–57% del contesto sono tool; un utente con sessioni dominate da letture di file enormi otterrebbe di più (il cookbook ha 96,3% di letture, ma su documenti da 41k token, non su codice).
- Obiezione alla formula del pareggio: se la cache avesse TTL più lungo e sessioni di 200+ giri senza compattazione, T > 42 sarebbe soddisfatto. Non è il caso in queste sessioni (compattazione ogni 50–80 giri).

### Trade-off ceduti
Rinunciare al GC significa rinunciare alla promessa «il contesto si pulisce da solo»: la qualità percepita (meno rumore) non è misurata e resta un'ipotesi.

### Falsificatore
Se una sessione tipica reale con almeno 150 giri senza compattazione (oggi non ce ne sono: tutte compattano ogni 50–80) mostra che il GC libera ≥30k token ogni 40 giri e le compattazioni calano, allora la formula T > 12,5·C/X cade e va rifatta la misura. Termine: alla prossima sessione lunga senza compattazione (cambio di `reserveTokens` o modello con finestra da 1M).
