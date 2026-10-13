---
status: done
created: 2026-10-13
source: user
---
# Caveman deve davvero ridurre i token, anche nel contesto delle sessioni lunghe

## Problema
Caveman è attivo nel prompt di sistema (verificato) ma nelle prove reali taglia solo il 9% dei caratteri visibili e il 4% dell'output, costo totale invariato.
L'utente si aspetta che dia il meglio nelle sessioni lunghe e che si attivi anche nel "context" (letto come: nel contesto che Pi costruisce e rimanda al modello: prompt di sistema,
riassunti di compattazione e testi generati per il contesto). Causa trovata: regole troppo blande (la clausola "se serve usa più parole" viene usata quasi sempre).

## Outcome atteso
- [x] 1. Diagnosi misurata: quanto del testo di output è visibile e quanto è ragionamento/tool, e perché le regole attuali tagliano poco (numeri in un file md). — prova: punto 17 di `eval/token-savings/08-alternative-da-ricerca.md`: testo visibile 17k token su 36,5k di output (46%); regola 8 vecchia dava il permesso di non tagliare; `chain-caveman.jsonl`
- [x] 2. Regole Caveman più incisive (stile `full` della skill originale, in italiano) che tagliano chiaramente di più il testo visibile, senza togliere negazioni, numeri, percorsi, codice, avvisi di sicurezza. — prova: `extensions/caveman.ts` (RULES, 1.958 caratteri; RULES_LITE = vecchie); test `extensions/caveman.test.ts` (7 pass) verifica negazioni, percorsi, avvisi, chiarezza nelle regole
- [x] 3. Caveman si applica anche al contesto: i riassunti di compattazione di Pi (o altro testo di contesto generato) sono asciutti, se Pi lo permette da estensione; altrimenti prova scritta del limite. — prova: `session_before_compact` in `extensions/caveman.ts` chiama `compact()` con `COMPACTION_RULES`; `compact-ab.mjs`: compattazione reale riuscita, riassunto -3% caratteri, -12% output (guadagno piccolo, documentato); errori → Pi usa il suo riassunto (test)
- [x] 4. Misura reale A/B in sessione lunga (stesso modello, 16 domande di spiegazione, 2 ripetizioni): output e caratteri calano in modo netto rispetto a spento e rispetto alle regole vecchie. — prova: `chain-caveman.mjs` 2 ripetizioni: output 36.473 → 22.446 (-38%), caratteri -42%, costo 493.408 → 338.045 (-31%), tempo -31%; vecchie regole -4%/-9%/+3%; `caveman-ab.mjs` 14 casi: output -31%, costo -7%
- [x] 5. Qualità e affidabilità non calano: stesse domande corrette e verifica dei fatti nelle risposte (controllo di fatti chiave e lettura di campioni). — prova: 16/16 in tutte le 6 catene e 14/14 nei casi brevi; identificatori conservati 74% (rumore tra due ripetizioni spento: 53%); lettura a campione della risposta sulle liste: dettagli e file:riga presenti
- [x] 6. Interruttore `PI_CAVEMAN=0` funziona ancora; test automatici aggiornati e verdi; avvio `pi-full` senza errori. — prova: `PI_CAVEMAN=0` → `ASSENTE` nel prompt; `node --test extensions/*.test.ts` 184 pass; `PI_CAVEMAN_COMPACT=0` testato; smoke `pi-full` senza errori
- [x] 7. Prova che Caveman è nel prompt di una sessione vera (domanda al modello) con le nuove regole. — prova: `PI_CAVEMAN=1 pi -p` → il modello cita alla lettera la regola 10 nuova; `lite` e `0` → ASSENTE

## Utenti e sistemi impattati
Utente di Pi (risposte in chat), `extensions/caveman.ts`, provider claude-code (prompt di sistema), compattazione sessione.

## Vincoli
- Nessuna perdita di qualità/affidabilità/profondità; negazioni, numeri, comandi, errori esatti; avvisi, azioni irreversibili, domande e testi scritti su file in frasi complete.
- Pi core non si modifica; solo estensioni. Niente commit/push senza richiesta. Ogni funzione spegnibile con variabile d'ambiente.
- Stesso modello (niente modelli più piccoli).

## Domande aperte
- "context credom" non è chiaro: interpretato come il contesto/compattazione di Pi. Se intendeva altro, correggere.

## Verifica
```bash
node --disable-warning=ExperimentalWarning --test extensions/caveman.test.ts
! (PI_UI_INTRO=0 timeout 6 script -qc "pi-full" /dev/null </dev/null 2>&1 | rg -i "SyntaxError|Error:")
# misura reale (lunga, ~5 min): node eval/token-savings/chain-caveman.mjs --mode full --attempt 1
```
