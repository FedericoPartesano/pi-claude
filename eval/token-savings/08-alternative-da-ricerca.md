# Esperimenti 8-10: alternative trovate in rete (dopo il risultato deludente dei livelli di contesto)

Fonti: AgentDiet (arXiv 2509.23586, ACM 3797084): taglia gli input del 39,9-59,7% e il costo totale del 21,1-35,9% a parità di
risultati; GitHub issue claude-code #74318 (sub-agent: ~14% di costo input evitabile); UsageCut (un sub-agent conviene quando
l'esplorazione altrimenti resta nel thread principale e viene riletta ogni turno); Boris (Claude Code) su HN: cache scaduta = costo pieno.

## 8. Unire chiamate esplorative consecutive (`batching.py`, simulazione sulle 16 sessioni)
945 di 3481 chiamate sono esplorazioni consecutive. Unirne 25/50/100% -> risparmio 5,0 / 10,1 / 20,1% (tetto).
Leva reale solo con prompt di sistema che chiede letture in parallelo (zero rischio di qualità).

## 9. Sub-agent per l'esplorazione (`subagent.py`, simulazione)
Contesto separato, nel principale resta solo un riassunto (10-25%). Stesso modello: -35/-38%. Con modello a 1/3 di prezzo: -50/-52%
(tetto, ignora fatti persi nel riassunto).

## 10. Haiku vs Sonnet su 10 domande di esplorazione reali (`haiku-vs-sonnet.mjs`, `results/haiku-vs-sonnet.jsonl`)
| | Corrette | Token equivalenti | Tempo | Chiamate |
|---|---|---|---|---|
| Sonnet | 10/10 | 59.680 | 83 s | 24 |
| Haiku | 10/10 | 96.574 (~32.200 a 1/3 di prezzo, se vale) | 92 s | 28 |
Affidabilità uguale; Haiku usa più token ma costa meno per token: ~-46% in prezzo, +10% di tempo. Il prezzo reale sul tuo piano
è sconosciuto (abbonamento): da verificare. Campione piccolo (1 ripetizione).

## Vault
smartlookup-mono/vault: 65 note, 1,1 MB, indice 5,5 KB (~1,5k token). `rg` sull'intero vault: 12 ms. Leggere veloce non è il
collo di bottiglia, né servono embedding per questa dimensione. In passato il modello ha usato bash sul vault 192 volte (cerca già bene).
Costo di tenerlo "sempre pronto": iniettare l'indice = +1,5k token a ogni richiesta (letto da cache a 0,1x: ~+150 equivalenti per
chiamata); conviene solo se evita >1 chiamata di esplorazione ogni ~10. Da misurare.

## Decisione (utente): niente modelli più piccoli
Haiku al posto di Sonnet è scartato come soluzione: il 10/10 era su domande facili di sola ricerca, non prova che regga su compiti
difficili; il rischio di errori silenziosi non vale il risparmio. Anche il cambio di modello rompe la cache. Le stime del 50% che
dipendono da un modello a 1/3 di prezzo (esperimenti 5 e 9) non contano più. Restano valide solo le leve con lo stesso modello.

## 11. Mappa del progetto + guida alla ricerca, prova reale A/B (`map-ab.mjs`, `results/map-ab.jsonl`; Sonnet, 10 domande x 2 ripetizioni)
| | Corrette | Chiamate | Tempo | Costo (token equivalenti) |
|---|---|---|---|---|
| Base | 20/20 | 50 | 162 s | 117.520 |
| Con mappa | 20/20 | 41 (-18%) | 146 s (-10%) | 123.210 (+4,8%) |
Affidabilità uguale, più veloce, ma il costo non scende: la mappa aggiunge testo al prompt e le domande erano già corte (2-3 chiamate).
Su `marked` (poco più di 100 file) la mappa serve poco; il guadagno atteso è su progetti grandi, ancora da misurare.

## 12. Caveman (caveman.so, JuliusBrussee/caveman, Apache-2.0): studio e prova reale
Tre parti: skill (risposte brevi, dichiarato -65% di output leggibile, ~-10% del totale), proxy locale (riduce log/JSON/diff
prima del modello, dichiarato -33,2% di input in 6 compiti) e scelta adattiva del modello (scartata dall'utente). Per Pi non c'è
integrazione nativa e `claude -p` parte con Caveman spento: adattate le regole in `extensions/caveman.ts` (italiano, prosa
completa per avvisi/azioni irreversibili/domande/file scritti, clausola "profondità e affidabilità prima della brevità").
Prova reale A/B (`caveman-ab.mjs`, Sonnet, 10 domande di codice + 4 spiegazioni, 1 ripetizione):
| | Corrette | Output | Costo | Tempo |
|---|---|---|---|---|
| Base | 14/14 | 9.733 | 151.107 | 161 s |
| Caveman | 14/14 | 8.553 (-12%) | 158.087 (+4,6%, rumore) | 151 s |
Nelle sole spiegazioni: output -11%, caratteri -13%, qualità uguale (stessi fatti e riferimenti). Risparmio totale reale: trascurabile
(il testo è una parte piccola dell'output; il resto sono argomenti dei tool e thinking). Tenuto attivo per leggibilità e brevità.
Il proxy di Caveman non è installato: richiede binari scaricati e un proxy davanti a `claude -p`; da valutare a parte.

### 12b. Plugin nativo e proxy di Caveman: prove reali (13/10)
- `claude -p --plugin-dir <caveman>`: con i flag del provider (`--setting-sources ""`) gli hook del plugin non partono (0 hook); le skill si
  caricano (25) ma il prompt cresce; input identico alla base (2.482 token). Senza `--setting-sources ""` partono, ma con tutto il resto di `~/.claude`.
- Binari locali (`caveman setup --install`, checksum verificati) in HOME isolata. `caveman-shrink` su campioni di `marked`:
  lettura file 0%, `rg` -17%, `git log -p` -3%. Il codice non viene toccato.
- Proxy in modalità `compress` davanti a Pi (ANTHROPIC_BASE_URL), 14 domande, Sonnet: base 14/14, 107.813, 187 s; proxy 14/14, 106.163 (-1,5%, rumore), 195 s.
  Statistiche del proxy: 42 richieste passate, 0 token compressi, 0 richieste idonee. Un primo tentativo era invalido (variabile non applicata) ed è stato rifatto.
- Conclusione: nessun guadagno sul nostro uso (poco testo comprimibile nei risultati dei tool). Proxy non installato nel sistema.

### 13. Misura completa di Caveman e della mappa su repo grande (13/10)
Tutte le prove: Sonnet, stesso modello, risposte verificabili. Costo = cacheRead×0,1 + cacheWrite×1,25 + input + output×5.
| Prova | Qualità | Costo | Tempo | Nota |
|---|---|---|---|---|
| Caveman regole di stile (14 domande) | 14/14 = 14/14 | +4,6% (rumore); output -12% | -6% | Attivo |
| Proxy `compress` davanti a Pi (14 domande) | 14/14 = 14/14 | -1,5% (rumore) | +4% | 0 token compressi |
| Estensione nativa Pi + proxy + recupero MCP (6 compiti pesanti: JSON, git log, file interi) | 6/6 = 6/6 | +8,6% | +25% | Proxy: 222 token risparmiati su 21 richieste idonee, 7 rotture di cache |
| `caveman-shrink` su campioni | – | lettura file 0%, `rg` -17%, `git log -p` -3% | – | Il codice non si tocca |
| `caveman browse` vs `fetch_content` (3 pagine) | – | 40k/62k/61k car. contro 12,6k/13,7k/38k | – | `fetch_content` già migliore |
| Mappa progetto su `smartlookup-mono` (10 domande, 5.238 file) | 10/10 = 10/10 | +12% | +5% | 2 richieste per domanda in entrambi: non c'è nulla da risparmiare |
Dettagli: con abbonamento il proxy comprime solo se il proxy ha `CAVEMAN_RECOVERY=mcp` e l'agente ha lo strumento `caveman_retrieve`;
il ponte dell'estensione chiama `caveman native-hook pi …`. Configurato tutto questo, il guadagno resta ~0 e la cache si rompe.
`caveman learn` su 884 sessioni Claude: 63% cache letta, 25% cache scritta, 12% output, 0% input fresco; le sue proposte (3 skill inutilizzate, ~219 token
a messaggio; 24 testi ripetuti) valgono poco. 30% dei token passa dai sub-agent.
Conclusione: nessuna di queste leve raggiunge il 40%. Unico risparmio reale e senza perdite: output -12% con le regole di Caveman (già attive).
Pulizia: rimossa la cartella `.pi/` creata dalle prove in `smartlookup-mono`; proxy fermato; binari e CLI solo in /tmp (HOME isolata).

### 14. Sub-agent con lo stesso modello per le letture grandi: prova reale (13/10)
`chain-sub.mjs`: catena di 8 passi su `marked` (5 letture di file interi, poi 3 domande di richiamo). Base: un'unica sessione. Sub: i passi 1-5 li esegue
un processo nuovo per passo (stesso Sonnet), la sessione principale riceve solo la risposta e fa i passi di richiamo. 2 ripetizioni per modo.
| | Corrette | Costo (medio) | Tempo |
|---|---|---|---|
| Base | 16/16 | 115.664 | 78-85 s |
| Sub-agent | 12/16 | 81.083 (-30%) | 127-135 s (+58%) |
Errori del sub-agent: conteggi di righe sbagliati (215, 211, 201 invece di 205 e 203) in 3 esplorazioni su 4 nei passi 4-5, contro 0 su 4 in base; nei richiami la sessione principale
risponde "non l'ho contato io". Risparmio reale (-30%) ma con perdita di affidabilità e +58% di tempo: viola il vincolo. Scartato.
Prove brevi come queste non misurano la perdita di fatti nei riassunti di sessioni lunghe: il rischio è anche maggiore lì.

### 15. Sessione lunga vera: 30 passi su `marked`, base contro context-tiers (13/10)
`chain-long.mjs`: 12 letture di file interi (3.970 righe), poi 18 domande di richiamo e controllo. Impostazioni normali (limite 30.000 token), Sonnet, Caveman attivo in entrambi, 2 ripetizioni.
| | Corrette | Costo | Tempo | Cache scritta |
|---|---|---|---|---|
| Base | 60/60 | 327.325 e 385.103 (media 356.214) | 79 e 93 s | ~64k |
| Context-tiers | 60/60 | 384.150 e 384.335 (media 384.243, +8%) | 97 e 98 s (+13%) | ~64k |
Qualità identica, nessun risparmio: anche su 30 passi il costo non scende (+8%) e il tempo sale. La cache scritta è uguale: i vecchi risultati non vengono quasi mai
svuotati perché il contesto resta sotto il limite per gran parte della catena. Conferma: context-tiers resta non registrato. Il costo di base varia del 18% tra due ripetizioni identiche (rumore).

### 16. Caveman acceso contro spento in sessione lunga di spiegazioni (13/10)
`chain-caveman.mjs`: 16 domande di spiegazione nella stessa sessione su `marked`, Sonnet, `PI_CAVEMAN=0` contro acceso, 2 ripetizioni. (La prova del punto 15 non misurava Caveman: era attivo in entrambi e le risposte erano "solo il numero".)
| | Corrette | Costo medio | Output medio | Caratteri risposta | Tempo |
|---|---|---|---|---|---|
| Spento | 32/32 | 493.408 | 36.473 | 67.171 | 278-366 s |
| Acceso | 32/32 | 506.017 (+2,6%) | 35.164 (-3,6%) | 61.371 (-8,6%) | 292-303 s |
Anche in sessione lunga: nessun risparmio di costo (differenza dentro il rumore, ~10% tra ripetizioni uguali). Il testo visibile cala del 9%, l'output totale del 4%: il resto
dell'output (ragionamento, chiamate ai tool) non è toccato dallo stile. Caveman resta attivo per leggibilità, non per risparmio.

### 17. Caveman risolto: regole più dure e riassunti di compattazione asciutti (13/10)
**Diagnosi.** Nella catena di 16 spiegazioni (spento) il testo visibile è ~67.000 caratteri ≈ 17.000 token su ~36.500 di output (46%); il resto è ragionamento e chiamate ai tool.
Le regole vecchie (ora `PI_CAVEMAN=lite`) tagliavano solo il 9% dei caratteri perché la regola 8 ("se serve usa più parole") dava al modello il permesso di non tagliare, e perché non c'era un limite di forma.
**Cambio.** `extensions/caveman.ts`: regole predefinite nuove (stile telegrafico, ogni fatto una volta sola, niente intestazioni/tabelle, spiegazioni ≤ ~12 righe, completezza misurata in fatti e non in frasi; restano intatti negazioni, numeri, percorsi, avvisi e testi scritti per esteso).
Inoltre `session_before_compact`: il riassunto di compattazione (un'altra chiamata, con prompt suo, su cui il prompt di sistema non agisce) riceve istruzioni asciutte tramite `compact()` di Pi; ogni errore → Pi usa il suo riassunto. `PI_CAVEMAN_COMPACT=0` spegne solo questo.
**Misura reale, sessione lunga** (`chain-caveman.mjs`, 16 spiegazioni su `marked`, Sonnet, 2 ripetizioni):
| | Corrette | Costo medio | Output medio | Caratteri | Tempo |
|---|---|---|---|---|---|
| Spento | 32/32 | 493.408 | 36.473 | 67.171 | 278-366 s |
| Regole vecchie (lite) | 32/32 | 506.017 (+3%) | 35.164 (-4%) | 61.371 (-9%) | 292-303 s |
| Regole nuove | 32/32 | 338.045 (**-31%**) | 22.446 (**-38%**) | 38.642 (**-42%**) | 209-233 s (**-31%**) |
**Domande brevi con risposta verificabile** (`caveman-ab.mjs`, 14 casi): spento 14/14, output 9.850, costo 153.080; nuove 14/14, output 6.781 (-31%), costo 142.649 (-7%), tempo 186 s → 163 s.
**Fatti conservati.** Identificatori tra apici presenti in entrambe le risposte "spento": 560; ancora presenti con le regole nuove: 417 (74%). Due ripetizioni identiche "spento" coincidono solo al 53%: la perdita non supera la variazione naturale.
Lettura a campione: risposte dense, con file:riga, regex e casi limite (es. lista, indentazione, `endEarly`).
**Compattazione** (`compact-ab.mjs`, sessione di 10 spiegazioni, un riassunto per modo): riassunto 5.570 → 5.383 caratteri (-3%), output 2.618 → 2.311 token (-12%). Guadagno piccolo, la compattazione avviene di rado; il formato fisso di Pi era già compatto.
**Limiti onesti.** Il risparmio del -31% è misurato su sessioni di spiegazioni (dove le risposte sono lunghe). Su lavoro fatto quasi solo di tool e modifiche (risposte già corte) il guadagno è minore: nei casi brevi -7%.
Il test di fatti è automatico (identificatori) più lettura a campione, non un giudice indipendente; 2 ripetizioni per modo.
