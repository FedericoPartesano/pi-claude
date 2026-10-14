---
status: ready
created: 2026-10-14
source: user
---

# Grafo del progetto dentro pi (/graph), stile Graphify

## Problema
Il modello esplora il progetto con molte ricerche e letture (token e tempo). Serve una mappa a grafo dell'intero progetto, costruita una volta in modo completo e poi aggiornata solo sui file nuovi o modificati, che pi sappia interrogare e mostrare. Riferimento: https://github.com/Graphify-Labs/graphify (nodi centrali, comunità, connessioni sorprendenti, report, vista HTML, query).

## Decisioni prese con l'utente
- Compromesso di estrazione: struttura con parser statico locale su tutti i file (gratis, ripetibile); LLM (Haiku) solo su documenti e concetti, e solo per i file cambiati; tutto in cache per hash di contenuto.
- Il grafo serve a tre usi: tool per il modello, riassunto nel prompt, vista HTML e report.
- Comando `/graph`, dati in `.pi/graph/` (escluso da git).

## Cosa deve fare
1. Scansione: file tracciati da git (o cartella se non è un repo), esclusi binari, lock, dist, node_modules; limite di dimensione per file.
2. Nodi: file, simboli (riuso di `extensions/lean/outline.ts`), documenti (sezioni markdown), test. Archi: `imports` (risolti a file reali), `defines`, `references` (simbolo esportato citato in un altro file), `tests` (test→codice), `documents` (doc cita un file o un simbolo). Ogni arco porta `kind` e `confidence` (extracted | inferred).
3. Incrementale: manifest con hash di contenuto per file; `update` rielabora solo file nuovi/cambiati/cancellati e gli archi che li toccano. Prima build completa, poi aggiornamenti in secondi.
4. Analisi: comunità (Louvain o label propagation in JS puro, senza dipendenze), nodi centrali per grado e intermediazione, connessioni sorprendenti (archi tra comunità lontane).
5. Embedding: nodi con vettore dall'embedder locale già presente (`extensions/lean/semantic.ts`) per cercare "concetti" in linguaggio naturale; cache per hash.
6. Passo LLM opzionale (`/graph build --semantic`): Haiku legge README/docs e riassume ogni comunità in una riga; cache per hash, mai riesegue su file invariati.
7. Uscite in `.pi/graph/`: `graph.json`, `GRAPH_REPORT.md` (nodi centrali, comunità, sorprese, difetti noti), `graph.html` (autonomo, force layout su canvas, ricerca, click sui nodi).
8. Comando `/graph build | update | status | query <testo> | path <a> <b> | explain <nodo> | open | report`.
9. Tool per il modello: `graph_query`, `graph_path`, `graph_explain`; riassunto breve (max ~1500 caratteri) dei nodi centrali e delle comunità nel prompt di sistema, stabile nella sessione (cache del prompt).
10. Aggiornamento automatico leggero: a `session_start` confronta gli hash; se il grafo esiste ed è vecchio avvisa nel footer ("GRAPH stale") senza ricostruire da solo; `/graph update` lo aggiorna.

## Outcome atteso
- [ ] `/graph build` su questo repo produce `graph.json`, `GRAPH_REPORT.md`, `graph.html` senza errori e senza dipendenze nuove.
- [ ] `/graph update` dopo la modifica di un solo file rielabora solo quel file (misurato: file rielaborati = 1) ed è molto più veloce della build.
- [ ] Gli archi `imports` sono corretti: test su un progetto di esempio con risultato noto.
- [ ] Comunità e nodi centrali ragionevoli sul repo (verifica a mano di almeno 3 comunità).
- [ ] Tool `graph_query/path/explain` rispondono con nodi e archi reali; test automatici.
- [ ] Riassunto nel prompt stabile (stesso testo a parità di grafo) e sotto il limite.
- [ ] Misura onesta: su 5 domande sul repo, token e tempo con e senza grafo; risultato riportato anche se negativo.
- [ ] Test automatici verdi, tsc senza errori, nessun commit senza richiesta.

## Vincoli
- Nessuna dipendenza nativa nuova (niente tree-sitter binario); solo Node e quanto già nel repo.
- Run lunghi in sequenza, senza saturare RAM/CPU; il passo LLM è opt-in.
- Nessun commit/push senza richiesta esplicita.

## Rischi noti
- I `references` per nome sono euristici (falsi positivi su nomi comuni): marcati `inferred`, con soglia sui nomi troppo generici.
- L'estrazione statica non capisce il significato: per questo il passo LLM opzionale.
- Linguaggi oltre TS/JS/Python hanno solo estrazione per regex.
