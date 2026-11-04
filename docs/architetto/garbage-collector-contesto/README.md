Aggiornato: 2026-11-03 · fase 6

# Garbage collector del contesto
**Decisione: non costruire il GC con cestino e promozione.** Contraddice l'idea iniziale.
- Replay di 3 sessioni vere (`sim-gc.cjs`): GC per sfratto da −7% a +4% di quota, tetto alla fonte da +1% a +8%; soglia 30%. Con cacheRead a peso 1 resta ≤ 5%.
- Perché: sfrattare riscrive la cache (1,25·C) e rende 0,1·X per giro: pareggio dopo 12,5·C/X giri (≈42 con C=100k, X=30k), più della vita tra due compattazioni (50–80 giri).
- La promozione per richiami non ha dati: 1, 0 e 22 rilanci identici in 1066, 418 e 822 giri.
- Resta valido: `extensions/context-tiers.ts` e il tetto alla fonte (2–8%); il 30% va cercato altrove (studio `../gestione-contesto-pi/`).
- Fonti: MemGPT, docs Anthropic context editing e cookbook, The Complexity Trap, Induction. Limiti in `90-ignoto.md`.
- Spesa: 6 ricerche/fetch, 3 profili repo (uno vuoto), 3 sessioni replay, 0 subagenti, 0 critici (dichiarato).
- Piano −30%: `40-piano-30.md` (leve impilate, 28–33% stimato). Falsificatore in `30-alternative.md`. Nessun ADR: decisione facilmente reversibile.
