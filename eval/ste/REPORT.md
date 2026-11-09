# STE (ASD-STE100) e STE+caveman come stile di risposta — 2026-11-09

Banco: `node eval/ste/run.mjs haiku`. 8 domande tecniche in inglese, 4 stili: normale, caveman (`RULES` di `extensions/caveman.ts`), STE (`RULES` di `extensions/ste.ts`), combo (`COMBO` di `extensions/ste.ts`: caveman + parole e frasi STE). `claude -p` con lo stile in `--append-system-prompt`, da cartella vuota e senza settings (il `CLAUDE.md` del repo falsava il primo giro, scartato). Un giro, una chiamata per cella. Dati: `eval/ste/results.json`.

I token di output di `claude -p` includono il pensiero (`thinking_tokens`): sono riportati a parte.

| Stile | Totale | Pensiero | Testo (token) | Caratteri | `-ing` | Passivi | Frasi >25 | Frase media |
|---|---|---|---|---|---|---|---|---|
| normale | 8283 | 1372 | 6911 | 18036 | 45 | 6 | 3 | 9,1 |
| caveman | 4027 | 660 | 3367 | 7861 | 21 | 1 | 0 | 7,5 |
| STE | 13292 | 8077 | 5215 | 13657 | 12 | 1 | 0 | 7,2 |
| combo | 6220 | 3004 | 3216 | 7553 | 11 | 0 | 0 | 5,0 |

Lettura:
- Il testo visibile: combo −53% dei token rispetto al normale, −4% rispetto al caveman; STE da solo −25%.
- Conformità STE: combo 11 `-ing` e 0 passivi contro i 21 e 1 del caveman.
- STE da solo fa pensare molto haiku (8077 token di pensiero contro 1372): il totale sale a +60% rispetto al normale. Il primo report («+8%, non serve a risparmiare») contava il pensiero come testo e non lo diceva.
- Il combo porta pensiero 3004: totale −25% rispetto al normale ma +54% rispetto al caveman. Il costo del pensiero dipende dal modello e dal livello di ragionamento (in Pi si imposta a parte): da misurare con il bridge vero.

Limiti: linter euristico (non quello ufficiale), 8 domande, un giro, un modello (haiku), nessuna misura di leggibilità o correttezza delle risposte. Il pensiero varia molto da una chiamata all'altra (0–1342 su una cella). Un legame con Karpathy non è confermato (`vault/wiki/concepts/asd-ste100.md`).

## Giudice cieco (`eval/ste/judge.mjs`, dati `eval/ste/judge.json`)

Sonnet come giudice, A/B in ordine casuale, 8 domande × 3 coppie. Criterio: chiarezza e correttezza per chi deve agire, «ignora la lunghezza».

| Coppia | Vittorie | Chiarezza | Correttezza |
|---|---|---|---|
| normale contro STE | 8 – 0 | 4,75 / 4,00 | 4,63 / 3,63 |
| normale contro combo | 8 – 0 | 4,88 / 4,00 | 4,75 / 4,13 |
| caveman contro combo | 4 – 4 | 3,88 / 4,63 | 4,50 / 4,50 |

Lettura: STE e combo perdono contro il normale perché omettono avvertenze, cause e casi limite (i motivi del giudice parlano di contenuto, non di stile). Il giudice resta sbilanciato verso le risposte complete: l'8–0 significa «le risposte più corte perdono», non «STE sbaglia». Caveman contro combo è pari, con il combo più chiaro. Un giudice, un giro, 8 domande.

Conclusione: STE non migliora le risposte in chat e non risparmia token; resta spenta di default. Il combo è alla pari col caveman in correttezza e più chiaro, ma con più pensiero.
