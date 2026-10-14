---
status: in-progress
created: 2026-10-14
source: user
---

# Trova un modo per bypassare e risolvere tutti i limiti e dire con certezza se Haiku+Opus è migliore di Opus full

## Problema
Il benchmark `eval/advisor/bench.mjs` ha limiti misurati: una sola ripetizione per cella, Haiku solo passa già tutti i task (nessuna separazione), tempi non confrontabili tra run, costi stimati con prezzi ipotizzati, qualità del ragionamento/codice non misurata, run lunghi (H3 Opus 22 min) e uso alto di RAM/CPU. Senza rimuoverli non si può dire con certezza se Haiku + advisor nativo Opus (`--advisor opus`) è migliore di Opus da solo.

## Outcome atteso
- [ ] Il benchmark finito: tutti i run del piano (H1-H4, bracci opus/advisor/solo, ≥2 ripetizioni) completati e registrati in `eval/advisor/results.jsonl`.
- [ ] Almeno un task in più dove Haiku solo fallisce (separazione dei bracci), con test nascosto.
- [ ] Qualità misurata oltre pass/fail: punteggio parziale sui test nascosti e giudizio cieco di Opus (`eval/advisor/analyze.mjs`) per ogni run.
- [ ] Costo reale (non stimato) ricavato dai dati di Claude Code (`total_cost_usd`/`costUSD` per modello) al posto dei prezzi ipotizzati.
- [ ] Confronto statistico onesto: media, min-max e numero di run per cella; esplicita dove la differenza è dentro la varianza.
- [ ] Verdetto finale con certezza dichiarata (o dichiarazione motivata che i dati non bastano): Haiku+Opus è migliore, uguale o peggiore di Opus solo su qualità, tempo, costo.
- [ ] Limiti noti e come sono stati superati, scritti in un report `eval/advisor/REPORT.md`, difetti prima dei successi.

## Utenti e sistemi impattati
Utente di pi-claude che decide se usare Haiku+advisor; `eval/advisor/*`; `pi-claude-code/src/claude-session.ts` e `provider.ts` (flag `--advisor`, log `modelUsage`).

## Vincoli
- Nessun commit/push senza richiesta esplicita.
- Non saturare RAM/CPU: run in sequenza.
- I test nascosti non vanno mostrati ai modelli.
- Il verdetto deve riportare anche i dati contrari.

## Domande aperte
Nessuna.

## Verifica
```bash
node eval/advisor/analyze.mjs
cat eval/advisor/REPORT.md
wc -l eval/advisor/results.jsonl
```
