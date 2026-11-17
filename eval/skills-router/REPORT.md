# Router delle skill: con e senza estensione

Data: 2026-11-13 · `node eval/skills-router/run.mjs` · 45 casi in `cases.json` (30 con skill attesa, 15 neutri o con `/skill:`/`/goal`).
«Senza estensione» = nessuna skill parte da sola (come prima: tutte `disable-model-invocation`). «Con» = `extensions/skills-router.ts` + `skills/router.json`.

## Risultati

| | Richiamo | Attivazioni sbagliate | Falsi su neutri | Casi giusti |
|---|---|---|---|---|
| Senza | 0% (0/30) | 0 | 0/15 | 15/45 (33%) |
| Con | **90% (27/30)** | 2 | 0/15 | **42/45 (93%)** |

Precisione 93% (27 utili su 29 attivazioni). Costo: 3294 token medi per attivazione (30 attivazioni), solo quando scatta; il prompt fisso non cambia. Tempo: < 5 ms a messaggio (test).

## Errori

Mancate: «scrivi il prd…» (la parola `prd` non pesa abbastanza da sola), «changelog e tag della release» (peso 1+1 in una sola regola, non somma), «sistema il layout css» (peso 1 da solo, soglia 2).
Sbagliate: «il codice è lento, ottimizza» attiva anche il debug (`lento`); «piano di rollback» attiva anche la pianificazione (`piano`). Entrambe affiancano la skill giusta, non la sostituiscono.

## Limiti (da leggere prima delle conclusioni)

- I casi li ho scritti io conoscendo le regole: il 90% è ottimistico. Un set scritto da altri, o dai messaggi reali dell'utente, darà meno.
- Misura solo la **scelta** della skill. Non misura se la **risposta del modello** migliora con la skill iniettata: serve un A/B con il modello (stessi compiti con e senza skill, controlli automatici sull'output), non fatto qui.
- Le skill costano ~3,3k token a attivazione: il guadagno di qualità va confrontato con questo costo.
- Nessuna correzione delle regole fatta dopo la misura, per non adattarle al set.

# Parte 2 — messaggi reali e A/B col modello (2026-11-13)

## Messaggi reali delle sessioni (`~/.pi/agent/sessions`)
Estratti 3785 messaggi utente unici (lunghezza ≤ 600, escluse sessioni di eval e testo iniettato) da 23 cartelle di progetto. I messaggi restano in locale (`/tmp`), non nel repo: contengono credenziali e host.

- Il router scatta su **353 messaggi (9,3%)**: debug 132, deploy 51, prestazioni 49, documenti 38, piano 31, API 27, review 17, sicurezza 11, idea 8, altre 4.
- Giudizio a mano su 40 attivazioni a caso: **15 giuste (38%)**, 7 dubbie, 18 sbagliate → precisione **38% (fino a ~55% con le dubbie)**, contro il 93% del set scritto da me. Quel 93% era ottimistico.
- Cause degli errori:
  1. parola chiave in un discorso, non in un compito: «i test e2e vanno scritti per far emergere bug», «spero non hai introdotto bug», «ottima idea»;
  2. tempo passato o stato: «ho fatto il deploy», «il deploy in prod è già partito»;
  3. parole ambigue: `pr` in «Unisci la PR», `crashes` come nome di file, `api` in un URL, `piano` come sostantivo qualsiasi;
  4. testo dei hook («Stop hook feedback: [finisci la roadmap]…») trattato come messaggio utente.
- Con ~9% dei messaggi e ~3,3k token per attivazione, circa 6 attivazioni su 10 sarebbero token sprecati.

## A/B col modello (8 compiti × 2 giri × 2 bracci, Sonnet)
Fixture «libreria» di `eval/cases.mjs`; compiti: bf01, bf02, bf05, bf06, ft06, ft08, qa03, qa08. Braccio **skill** = la skill scelta dal router aggiunta con `--append-system-prompt`; **base** = niente. Controlli automatici dei casi. Dati: `ab.jsonl`, script `ab.mjs`.

| Braccio | Pass | Costo mediano | Costo totale | Tempo mediano | Turni mediani | Token out mediani |
|---|---|---|---|---|---|---|
| base | 16/16 | 0,157 $ | 2,09 $ | 20,9 s | 6 | 833 |
| skill | 16/16 | 0,172 $ | 2,40 $ | 28,0 s | 8 | 1468 |

- **Correttezza: nessuna differenza.** Tutti i compiti passano in entrambi i bracci: il fixture è troppo facile per far emergere un vantaggio (effetto soffitto).
- **Costo: +15% in dollari, +34% di tempo mediano, +76% di token in output.** Più turni (bf05: 4,5→11; bf06: 3→9): la skill di debug fa aggiungere passaggi (riproduzione, causa, verifica) anche a bug banali.
- Sulle domande di sola lettura (qa03, qa08) il router attiva il debug senza motivo: costo +8-17% per risposta identica.
- Unico caso in cui la skill costa meno: ft08 (documenti), −21%, con 2 giri: non distinguibile dal rumore.

## Conclusioni
1. **La qualità non aumenta sui compiti misurati**: stessa correttezza, costo maggiore. Questo non prova che le skill non servano: servono compiti dove il modello da solo sbaglia (bug ambigui, feature con requisiti nascosti, review di diff veri).
2. **Il router così com'è non va attivato di default**: precisione reale 38-55%. Prima vanno corretti i falsi (verbi di compito/imperativo, esclusione del tempo passato e dei messaggi dei hook, soglia più alta per `pr`/`api`/`piano`) e rimisurati sullo stesso campione, tenendone una parte fuori dalla messa a punto.
3. Limiti: un solo modello, 2 giri, 8 compiti facili; giudizio manuale su 40 attivazioni.

## Parte 3 — Meno falsi positivi (2026-11-13)

Cosa fanno gli altri (ricerca web): regole dure prima del punteggio, penalità di ambiguità/scope, soglie a fasce, attivazione differita, parole generiche solo con un secondo segnale (policy `sergiusavva`, `hussi9/skill-router`, SkillRouter/ToolPicker).

**Metodo.** 603 messaggi reali: i 353 su cui il router v1 scattava più 250 a caso tra gli altri. Etichette dal giudice Opus (`claude -p --model opus`): quali skill voleva davvero l'utente per quel messaggio, severo su discorsi, tempo passato, output di hook. Split per id: pari = messa a punto, dispari = holdout (mai guardato mentre scrivevo le regole). I non scattati pesano popolazione/campione. Script: `real.mjs`. I messaggi e le etichette restano in `/tmp` (contengono credenziali).

**Modifiche al router** (`skills/router.json`, `extensions/skills-router.ts`):
- `frame`: una parola chiave pesa 1; serve una cornice di richiesta (imperativo, «voglio/puoi/devo…») per arrivare a soglia 2. Frasi inequivocabili («fai la review», «scrivi i test») pesano 2.
- `veto`: testo dei hook, avvisi, tempo passato («deploy fatto», «hai fatto»), riferimenti a «piano N»/«task N».
- `maxLen` 600; gli URL tolti prima del confronto.

| | v1 | v2 |
|---|---|---|
| precisione, messa a punto | 40% | 67% |
| precisione, **holdout** | 45% | **63%** |
| richiamo, holdout | 13% | 16% |
| attivazioni su 3785 messaggi (holdout) | 4,6% | 4,0% |
| `cases.json`: richiamo / falsi su neutri | 90% / 0 | 87% / 1 |

Limiti: il richiamo basso è in gran parte un'etichetta generosa (frontend, debug in prosa); la precisione resta sotto il 85% di riferimento della policy. L'etichettatore è un modello, non l'utente. Il test A/B (parte 2) non è ripetuto: costo per attivazione invariato (~3,3k token).

Prossimi: fascia media come solo suggerimento (chip), attivazione differita sui test rossi, embedding locale come secondo stadio.

## Parte 4 — Astensione a due fasce (2026-11-13)

**Studio.** Policy di routing (`sergiusavva`), `hussi9/skill-router`, ToolPicker, SkillRouter, post Quanta/Klymentiev: tutti convergono su (1) regole dure prima del punteggio, (2) astensione sotto soglia, (3) fascia media = chiedi/suggerisci, (4) parole generiche solo con prova distintiva, (5) secondo stadio (embedding/reranker) solo se serve. Applicato 1-4; l'embedding non serve: il collo di bottiglia era la precisione, non il vocabolario.

**Modifiche.** `autoThreshold` 3: inietta solo con segnale forte; 2-3 = «suggerita» (chip, nessun token). `bug`/`crash` da soli non sono più forti (nei messaggi dell’utente «bug» è spesso un sostantivo: era la causa quasi unica dei falsi nella fascia alta). Il tier è nell'`Activation`.

**Misura su campione NUOVO** (`fresh.mjs`): 500 messaggi reali mai usati per le regole (200 scattati a qualsiasi fascia + 300 a caso), etichette Opus. Attenzione: la rimozione di `bug` come segnale forte l'ho decisa guardando falsi del set dispari, quindi quel set non è più holdout pulito; il campione nuovo sì.

| | |
|---|---|
| precisione auto | 100% (91/91, IC95% 96-100%) |
| precisione suggerimento | 49% (61/124, IC95% 41-58%) |
| richiamo auto / auto+suggerimento | 10% / 16% |
| latenza | 0,04 ms/messaggio (0,006 ms nel micro-benchmark) |
| `cases.json` (45 casi) | richiamo 53%, precisione 100%, 0 falsi sui neutri |
| set messa a punto / dispari | 95% / 96% |

**Limiti.** Il 90% delle attivazioni auto è git («committa», «pusha»): il router «attivo di default» di fatto è un router di commit, più poche attivazioni su deploy e debug. Precisione di intento ≠ utilità: A/B (8 compiti × 2 giri, Sonnet) 16/16 pass in entrambi i bracci, costo +1,5%, 3 compiti su 8 attivano. Il giudice è un modello, non l'utente. Il richiamo basso è il prezzo dell'astensione; la fascia suggerimento (49%) resta fuori dall'iniezione.

### Qualità oltre i test (giudice cieco, `judge.mjs`)
Le skill servono anche a ragionare, controllare e lavorare in modo più pulito: i test non lo vedono. Giudice Opus cieco (ordine casuale) sui diff base vs skill dei 3 compiti dove la skill scatta × 2 giri (6 coppie): ragionamento 0-0 (6 pari), verifica 0-0, pulizia 0 skill / 1 base, professionalità 1 skill / 0 base, complessivo 0-0. Nessuna differenza su compiti piccoli; limite: solo il diff, non la risposta testuale né il processo, e compiti troppo semplici. Per i compiti complessi serve un banco nuovo.

### Compiti complessi (`complex.mjs` + `complex-judge.mjs`)
5 compiti ambigui o multi-aspetto (debug alla radice, funzione di ricerca da specificare, export CSV sicuro, review di codice, release), 2 giri, Sonnet, con e senza le skill adatte nel prompt di sistema. Criteri nascosti eseguiti nel repo + giudice Opus cieco (diff e messaggio finale, ordine casuale), 10 coppie.
- Criteri nascosti: base 57/70, skill 51/70. Il divario è un solo run (cx02 giro 2, 1/8): la skill ha restituito un oggetto invece di un array, il mio criterio assumeva l'array (forma non specificata). Senza quel run: 50/62 contro 50/62, pari. «test verdi» in cx05 fallisce ovunque perché il test su `totalValue` è già rosso nella fixture: criterio sbagliato, non si legge.
- Costo: $2,41 contro $2,18 (+10,6%), tempi simili.
- Giudice cieco: verifica 8 skill / 1 base / 1 pari (test scritti e riportati con più onestà); professionalità 5-3; ragionamento 4-5; pulizia 2-3 (5 pari); complessivo 5-5.
- Lettura: le skill non migliorano il ragionamento né la correttezza misurabile; migliorano in modo netto la verifica (test aggiunti e dichiarati). Costo +10% sui compiti complessi, contro +1,5% sui semplici. Campione piccolo (10 coppie): la differenza sulla verifica è l'unica oltre il rumore.
- Limiti: criteri scritti da me (fragili sulla forma del risultato), un solo modello, skill iniettate nel prompt di sistema invece che dal router.
