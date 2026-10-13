---
status: done
created: 2026-10-12
source: user
---

# Risparmiare almeno il 50% di token in Pi senza perdere qualità

## Problema
Una sessione tipica di Pi rilegge il contesto a ogni chiamata (cache letta 52% del costo, cache scritta 28%, output 20%).
Nelle sessioni reali salvate il contesto mediano è ~65k token. Lo svuotamento a blocchi dei vecchi risultati dei tool
risparmia solo ~20% simulato. L'utente vuole ≥50% di risparmio con soluzioni architetturali, senza abbassare
qualità e affidabilità del codice, della conversazione, dei piani, delle spec e dei test (nessuna allucinazione in più,
nessun test o piano superfluo o fatto male).

## Outcome atteso
- [x] 1. Ricerca su internet di approcci noti/innovativi (prompt caching, context editing, compaction, tool-result clearing, sub-agent per isolare contesto, memory tool, retrieval, modelli piccoli per compiti meccanici, ecc.) sintetizzata in un file md con fonti. — prova: eval/token-savings/00-ricerca-web.md (fonti JetBrains, Anthropic, arXiv 2601.06007, LiteLLM)
- [x] 2. Un modello di costo (token equivalenti: lettura cache, scrittura cache, output) calibrato sulle sessioni reali salvate in ~/.pi/agent/sessions, riproducibile con uno script nel repo. — prova: `cd eval/token-savings && PYTHONPATH=. python3 model.py`: reale 57,3M vs modello +6%/-9%; 01-modello-calibrato.md
- [x] 3. Per ogni esperimento empirico, un file md in eval/ con ipotesi, metodo, numeri e conclusione (anche se negativa). — prova: eval/token-savings/01..05-*.md (modello, ripartizione, leve, finestra adattiva, routing), ognuno con script riproducibile
- [ ] 4. Una combinazione di soluzioni architetturali che, sulle sessioni reali, stima un risparmio ≥50% del costo in token equivalenti.
- [ ] 5. Prova che la qualità/affidabilità non cala: per ogni soluzione, una misura (o un test) che dimostra che l'informazione necessaria resta recuperabile e che nessun comportamento di sicurezza/qualità (guard, memoria, test del modello) viene rimosso; i rischi residui sono dichiarati.
- [ ] 6. Le soluzioni scelte sono implementate (estensione/e di Pi, con interruttore per spegnerle) con test automatici verdi.
- [ ] 7. Verifica end-to-end con Pi vero (pi-full, terminale reale): le funzioni si attivano, non rompono l'avvio e i test esistenti restano verdi.
- [ ] 8. Un riepilogo finale con la stima totale (≥50%) e i limiti onesti della stima.

## Utenti e sistemi impattati
- L'utente (federico) che usa Pi / pi-full su WSL2.
- Estensioni pi-claude: lean-tools, memory, goal, intent, pi-ui; contesto e compaction di Pi core (non modificabile: solo da estensione).
- Provider claude-code (cache Anthropic a 5 minuti).

## Vincoli
- Vietato abbassare qualità e affidabilità: nessuna perdita di informazioni necessarie, nessuna allucinazione in più, nessun piano/spec/test peggiore o superfluo.
- Pi core in node_modules non si modifica: solo estensioni.
- Nessun commit/push senza richiesta esplicita dell'utente.
- UI semplice, parole chiare, nessun gergo; ogni funzione deve poter essere spenta con una variabile d'ambiente.
- Risparmio stimato dal modello di costo su sessioni reali; non si possono pagare chiamate reali in massa.

## Domande aperte
- Quanto delle rilegge dopo lo svuotamento erode il guadagno (da misurare)?
- Il provider claude-code (CLI) permette di controllare la cache o il contesto?
- Sub-agent / modelli più piccoli: la qualità resta uguale sui compiti meccanici (da misurare)?

## Verifica
```bash
python3 -I eval/token-savings/simulate.py
node --test extensions/*.test.ts
(cd pi-memory && node --disable-warning=ExperimentalWarning --test test/*.test.ts)
(cd pi-ui && node --disable-warning=ExperimentalWarning --test test/*.test.ts)
PI_UI_INTRO=0 timeout 6 script -qc "pi-full" /dev/null </dev/null 2>&1 | rg -i "SyntaxError|Error:"
```

## Risultato intermedio (onesto)
Leve sicure sulle sessioni vere: 15-23% (finestra adattiva, 04), indice 11%, routing max teorico 30% (05, non provato per qualità). Combinate al massimo ~44% teorico con rischio qualità: ≥50% senza perdere qualità NON dimostrabile con i dati attuali.

## Decisione dell'utente (2026-10-13)
Anche circa il 40% di risparmio è un risultato accettabile, purché misurato e senza perdere qualità, affidabilità e velocità.
Niente modelli più piccoli. Il 40% va dimostrato con prove reali (stesso modello), non solo con simulazioni.

## Esito finale (2026-10-13)
Obiettivo del 50% (e del 40% accettato) NON raggiunto con prove reali senza perdere qualità, tempo o affidabilità. Tutte le leve sono misurate (08-alternative-da-ricerca.md, punti 11-14):
- Caveman, regole di stile: output -12%, costo invariato, 14/14. Attivo (extensions/caveman.ts, PI_CAVEMAN=0 lo spegne, registrato in package.json).
- Proxy, estensione nativa e plugin di Caveman: -1,5% / +8,6% / non si attiva; scartati.
- Mappa progetto: chiamate -18% su repo piccolo, ma costo +5% / +12% (smartlookup-mono). Non registrata.
- Svuotare vecchi risultati dei tool (context-tiers): contesto -87%, costo +3,8%, tempo +19%. Non registrata.
- Sub-agent, stesso modello: costo -30% ma +58% di tempo e 12/16 corrette contro 16/16. Scartato.
- Modelli più piccoli: scartati dall'utente.
Combinazione dimostrata: solo Caveman (output -12%, costo totale ~0%). Stima teorica senza prova (batching 5-10%) non raggiunge il 40%.
