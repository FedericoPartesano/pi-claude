# Vault: solo vettori contro ibrido (vettori + BM25)

Corpus: 27 file markdown di questo repo (intents, docs, README, NOTES, HANDOFF), 337 sezioni. Modello reale e5-small, CPU senza GPU (16 thread). Riprodurre: `node eval/vault/compare.ts`. 12 query: 5 con token esatti, 5 concettuali, 2 fuori tema. Hit = file atteso tra i primi 3.

| | solo vettori | ibrido |
|---|---|---|
| Totale (12) | 8 | 10 |
| Token esatti (5) | 1 | 5 |
| Concettuali (5) | 5 | 5 |
| Risultati su query fuori tema (2) | 0 | 1 |

Verdetto: BM25 tenuto. Vantaggio netto sui token esatti (nomi di variabile, percorsi, sigle), nessuna perdita sui concetti.

Difetti:
- Campione piccolo (12 query scritte da me, un solo corpus, non il vault reale dell'utente).
- Prima versione dell'ibrido (qualsiasi parola in comune) dava 6 risultati sulle 2 query fuori tema (parole comuni italiane). Ora un chunk entra solo da BM25 se ha una parola rara (in al massimo il 3% dei chunk): 1 risultato residuo, la parola "domani" presente davvero in una nota.
- Il pavimento del coseno di e5-small (0.78) lasciava passare tutto: migliori coseni fuori tema 0.80-0.81, concettuali 0.875-0.905. Aggiunto margine 0.06 (pavimento 0.84): calibrazione su pochi punti, da rifare sul vault reale.
- Velocità embedding su note reali: 4,6 sezioni/s (72,9 s per 337 sezioni). Un benchmark sintetico di testi corti e uniformi aveva dato 15 sezioni/s: non rappresentativo.

## Vault reale: smartlookup-mono (20 ott, `node eval/vault/real.ts <repo>`)

70 file, 1240 sezioni, embedding 187 s (6,6 sezioni/s; una prova precedente 4,1/s: dipende dal carico della macchina). 15 query: 6 token, 6 concetti, 3 fuori tema.

| | solo vettori | ibrido |
|---|---|---|
| Totale (15) | 13 | 13 |
| Token (6) | 6 | 6 |
| Concetti (6) | 5 | 5 |
| Risultati su fuori tema (3 query) | 3 | 3 |

- Qui i vettori da soli trovano già i token (sigle ADR-007, nomi di file): BM25 non aggiunge nulla sul vault ma non fa male. Resta tenuto per i token che non somigliano a nessuna frase.
- Errore comune a entrambi: "bug in produzione dopo la build" (finisce su log.md/AGENT.md invece del bug).
- Fuori tema: "ricetta della carbonara" trova `Recipes.md` (esiste una nota sulle "ricette" delle viste: vicinanza semantica vera, non rumore del tutto); "come vincere a scacchi" 0 risultati; "previsioni del tempo" 3 risultati su log.md nell'ibrido prima della correzione.
- Correzione: con 4 o più parole utili BM25 non può più far entrare un chunk da solo (solo riordina); sotto le 4 parole serve una parola rara e metà delle parole utili. Effetto sul repo pi-claude: token esatti 5/5 → 4/5, fuori tema ibrido 6 → 1. Compromesso accettato.
