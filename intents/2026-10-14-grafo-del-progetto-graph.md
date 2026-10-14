---
status: in-progress
created: 2026-10-14
source: user
---

# Grafo del progetto dentro pi (/graph): motore proprio da confrontare con Graphify

## Problema
Il modello esplora il progetto con molte ricerche e letture (token e tempo). Serve una mappa a grafo dell'intero progetto, costruita una volta in modo completo e poi aggiornata solo sui file nuovi o modificati, che pi sappia interrogare e mostrare. Riferimento: https://github.com/Graphify-Labs/graphify (nodi centrali, comunità, connessioni sorprendenti, report, vista HTML, query).

## Decisioni prese con l'utente
- Compromesso di estrazione: struttura con parser statico locale su tutti i file (gratis, ripetibile); LLM (Haiku) solo su documenti e concetti, e solo per i file cambiati; tutto in cache per hash di contenuto.
- Il grafo serve a tre usi: tool per il modello, riassunto nel prompt, vista HTML e report.
- Comando `/graph`, dati in `.pi/graph/` (escluso da git).
- (14 ott) `/graph` senza argomenti apre un menu ordinato (stato, build veloce, aggiorna, build + semantica, gruppi, file centrali, connessioni sorprendenti, concetti, cerca, spiega). Durante le build un pannello mostra fase, progress bar, token (in/out), costo USD, tempo e stima del rimanente; Esc annulla il passo con modello. L'esito resta nella conversazione, non in un avviso che sparisce.
- (14 ott) Passo semantico con Haiku implementato ora (non rimandato): sequenziale, con conferma e stima token prima di partire, cache per hash, concetti come nodi `concept` con archi `explains` (`inferred`).
- (14 ott) **Criterio di scelta del motore**: Graphify (https://github.com/Graphify-Labs/graphify, collaudato e noto) è il riferimento. Il motore proprio si tiene solo se regge il confronto con Graphify sullo stesso repo; altrimenti si passa a Graphify. Il vincolo "niente dipendenze native" decade se Graphify vince.
- (14 ott, decisione finale dell'utente) **Sotto il cofano `/graph` usa Graphify** (`extensions/graph/graphify.ts`): build = `graphify update` (AST tree-sitter locale, 0 token), query/explain/path/god-nodes = sue CLI, output in `graphify-out/` escluso da git via il file di esclusione locale. Il motore proprio resta nel repo, attivabile con `PI_GRAPH_ENGINE=custom`, e si collauda con calma più avanti contro Graphify (criterio sopra). Il passo semantico con Haiku e il menu del motore proprio restano solo in modalità custom; in modalità Graphify la semantica (`graphify extract`, serve backend LLM) non è collegata.
- (14 ott) Graphify era installato ma rotto (`ModuleNotFoundError`); reinstallato con `uv tool install --reinstall graphifyy` (v0.9.90, usa tree-sitter).

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
- [ ] (rimandato, da fare con calma) Confronto onesto con Graphify sullo stesso repo (file coperti, nodi, archi, correttezza di un campione di archi verificati a mano, comunità, tempo di build e di update, uso di token/costo): difetti del motore proprio prima dei successi, e verdetto esplicito "teniamo il nostro" o "passiamo a Graphify" in `eval/graph/REPORT.md`.
- [ ] `/graph` apre il menu; provato in una sessione pi interattiva reale (menu, build con pannello e progress bar, Esc, token e costo mostrati).
- [ ] Il costo USD mostrato dal passo semantico coincide con quello reale (verificato sul provider `claude-code`).
- [ ] `/graph build` su questo repo produce `graph.json`, `GRAPH_REPORT.md`, `graph.html` senza errori (oggi solo `graph.json`).
- [ ] `/graph update` dopo la modifica di un solo file rielabora solo quel file (misurato: file rielaborati = 1) ed è molto più veloce della build.
- [x] Gli archi `imports` sono corretti: test su un progetto di esempio con risultato noto. — prova: `extensions/graph/graph.test.ts` e `config.test.ts` (monorepo, alias tsconfig, `exports`, `references`), verdi
- [ ] Comunità e nodi centrali ragionevoli sul repo (verifica a mano di almeno 3 comunità).
- [ ] Tool `graph_query/path/explain` rispondono con nodi e archi reali; test automatici.
- [ ] Riassunto nel prompt stabile (stesso testo a parità di grafo) e sotto il limite.
- [ ] Misura onesta: su 5 domande sul repo, token e tempo con e senza grafo; risultato riportato anche se negativo.
- [x] Test automatici verdi, tsc senza errori, nessun commit senza richiesta. — prova: `node --test extensions/graph/*.test.ts` 24/24, `npx tsc --noEmit -p .` 0 errori; commit f5880bf fatto su richiesta esplicita (i cambi successivi, menu e semantica, non sono ancora committati)

## Vincoli
- Nessuna dipendenza nativa nuova nel motore proprio (niente tree-sitter); vale solo finché si tiene il motore proprio (vedi criterio di scelta).
- Run lunghi in sequenza, senza saturare RAM/CPU; il passo LLM è opt-in.
- Nessun commit/push senza richiesta esplicita.

## Rischi noti
- I `references` per nome sono euristici (falsi positivi su nomi comuni): marcati `inferred`, con soglia sui nomi troppo generici.
- L'estrazione statica non capisce il significato: per questo il passo LLM opzionale.
- Linguaggi oltre TS/JS/Python hanno solo estrazione per regex (Graphify usa tree-sitter: probabile punto debole del motore proprio).
- Il passo semantico non è mai stato eseguito dentro pi; stima token approssimativa (~3,5 caratteri/token).

## Misure sul repo (14 ott, copia git senza dipendenze)
- Graphify `update`: 514 file elaborati, 4068 nodi, 8555 archi (1669 `imports_from`, 1546 `imports`, 1506 `calls`), 223 comunità; 13 s la prima volta, 25,8 s la seconda (non spiegato); 0 token. Ha `calls` a livello di funzione che il motore proprio non ha.
- Motore proprio: 491 file, 4427 archi, ~0,25 s. Più veloce di ~50x, ma senza `calls`, senza tree-sitter, senza HTML/report.
- Difetti visti in Graphify: nodi rumore (`ref_node_fs`, `ref_node_path`), nodi duplicati (`colors` x3 tra i più connessi), 607 file non classificati, 69 file di codice senza simboli, `path` diretto di default (risolto con `--undirected`).
- Verità indipendente sugli import (TypeScript `resolveModuleName`) preparata in `/tmp/gt.cjs` ma non eseguita: il modulo `typescript` non è stato trovato.

## Rumore di Graphify e semantica (14 ott)
- Causa del rumore misurata: 51 nodi `ref_*` (moduli esterni) toccano 1042 archi su 8558 (12%); `colors` x3 erano la chiave dei temi JSON letta come codice (non duplicati veri). Rimedio: copia filtrata `graphify-out/graph.pi.json` (senza `ref_*` e senza nodi da file JSON) usata da query/explain/path e dalla classifica nel prompt, con il file accanto al nome. Risultato: classifica centrale ora `pi-ui/index.ts`, `memory.ts`, `recall.ts`, `store.ts`...; `path recall.ts → bug.ts` non passa più da una libreria condivisa (ora "nessun percorso").
- Semantica con Claude Code: voce di menu e `/graph semantic` lanciano `graphify extract --backend claude-cli --max-concurrency 1` con `GRAPHIFY_CLAUDE_CLI_MODEL=haiku` (override `PI_GRAPH_MODEL`), poi `cluster-only`. Provato a riga di comando su un mini-repo: 2 documenti, 18 s, ~80k token in / 2,9k out (overhead della CLI), costo $0 sul piano. Non provato su questo repo né dentro pi.
