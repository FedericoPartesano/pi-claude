---
status: in-progress
created: 2026-10-20
source: user
---

# Vault Obsidian e CLAUDE.md indicizzati e cercabili (embedding locale + BM25), con conferma

## Problema
Il modello non conosce le note del vault Obsidian dell'utente né i CLAUDE.md oltre a quello che Claude Code carica da solo. Serve un indice locale, sempre pronto, che il modello interroga solo quando serve, senza gonfiare il prompt.

## Decisioni prese con l'utente
- Il vault è una cartella Obsidian locale (rilevata da `.obsidian/` nel cwd, o percorso in config/`PI_VAULT`). Se non c'è, non succede nulla.
- Niente parte da solo: a `session_start` solo rilevamento e una riga nel footer ("Vault: N note da indicizzare"); l'indicizzazione parte dopo conferma, con stima prima (coerente con la decisione #r46).
- Uso nel modello: tool `vault_search` e `vault_read`, più una sola riga fissa e corta nel prompt (~30 token, stabile per la cache) che dice di usare il tool se serve. Prompt il più snello possibile.
- Passo base solo locale e gratis (embedding). Riassunti LLM solo come passo opzionale separato, con stima token e conferma; non nella prima versione.
- Ricerca ibrida (vettori + BM25, fusione RRF) inclusa **solo se** il confronto misurato la giustifica (vedi outcome).
- Modulo nuovo `extensions/vault/`, separato dal grafo `/graph` (i documenti del vault non entrano nel grafo nella prima versione). Non si estende `CodeIndex`: si riusa solo l'interfaccia `Embedder` di `pi-memory/src/embed.ts`.

## Cosa deve fare
1. Rilevamento: `CLAUDE.md` (cwd e `~/.claude/CLAUDE.md`) e vault; solo `.md`; esclusi `.obsidian`, `.git`, `.trash`, cartelle nascoste, `.vaultignore`; limite di dimensione per file.
2. Chunk per titoli H1-H4; sezioni lunghe spezzate ai paragrafi (~800 caratteri); blocchi di codice interi; frontmatter, tag e wikilink come metadati; percorso, sezione e righe di origine per ogni chunk.
3. Embedding con l'embedder locale esistente (e5-small multilingue, worker thread), batch da 32.
4. Incrementale: hash di contenuto per chunk (non la sola mtime); stati nuovo/modificato/cancellato; chunk orfani eliminati; nel file dell'indice nome modello e dimensione dei vettori, reindicizzazione completa se cambiano.
5. Indice in `.pi/vault/` (o accanto al vault se fuori dal repo), escluso da git.
6. Ricerca: coseno con soglia del profilo del modello (`semFloor`/`semSpan`); se l'ibrido passa il confronto, BM25 (riuso/adattamento da `pi-memory/src/recall.ts`) fuso con RRF.
7. Comando `/vault` con menu: stato, indicizza (con stima e conferma), aggiorna, cerca.
8. Tool `vault_search(query, k)` → percorso, sezione, estratto; `vault_read(percorso, sezione)`; sola lettura.
9. Footer con parole chiare (preferenza #r4), senza simboli o gergo.

## Outcome atteso
- [x] Rilevamento: con `.obsidian/` o `PI_VAULT` il footer mostra le note da indicizzare; senza vault nessun effetto. Test automatici. — prova: `extensions/vault.test.ts` (footer "Vault: N sezioni da indicizzare" a session_start) e `extensions/vault/vault.test.ts` (scan: PI_VAULT, .obsidian, nascosti, .vaultignore), verdi
- [x] Nessuna indicizzazione senza conferma; la stima (note, chunk, tempo) è mostrata prima. — prova: test "senza conferma niente viene indicizzato": la stima compare nel confirm, con rifiuto indice vuoto; con conferma, seconda esecuzione senza richiesta
- [x] Il chunker rispetta titoli, blocchi di codice e limite; test su note di esempio con risultato noto. — prova: test chunk in `extensions/vault/vault.test.ts` (titoli, righe, tag, wikilink, codice intero, limite 800)
- [x] Update incrementale: dopo la modifica di una nota si ri-embeddano solo i suoi chunk modificati (misurato); una nota accorciata non lascia chunk orfani; cambio modello → reindicizzazione completa. Test automatici. — prova: test update/plan: modifica di 1 sezione = 1 embeddata, 2 riusate; nota accorciata = nessun orfano; cambio modello = tutto rifatto
- [x] `vault_search` e `vault_read` rispondono con risultati reali; la soglia scarta le query non pertinenti; test automatici con embedder finto. — prova: test integrazione con embedder finto (ricerca, sezione, CLAUDE.md, `../../etc/passwd` rifiutato); soglia: query fuori tema = 0 risultati con i soli vettori (eval/vault/REPORT.md)
- [x] Riga nel prompt stabile (stesso testo a parità di stato) e sotto ~40 token. — prova: test "prompt": nessuna riga prima dell'indice, testo identico a parità di stato, mai duplicata, 130 caratteri (~37 token)
- [x] Confronto solo vettori contro ibrido su ~10 query (token esatti e concetti) su un vault reale: risultato riportato anche se negativo; BM25 tenuto solo se migliora. — prova: `eval/vault/REPORT.md`: 12 query su 27 file reali, token esatti 1/5 contro 5/5, concetti 5/5 pari; BM25 tenuto; difetti elencati
- [x] Tempo reale di embedding su CPU misurato su un vault reale e riportato. — prova: `eval/vault/REPORT.md`: 4,6 sezioni/s su 337 sezioni reali (72,9 s), CPU 16 thread; il benchmark sintetico (15/s) non era rappresentativo
- [ ] Provato in una sessione pi interattiva reale (footer, conferma, ricerca dal modello).
- [x] Test automatici verdi, `npx tsc --noEmit -p .` senza errori, nessun commit senza richiesta. — prova: `node --test extensions/vault.test.ts extensions/vault/vault.test.ts` 15/15; tsc strict sui file nuovi 0 errori (il repo non ha un tsconfig radice); nessun commit fatto

## Vincoli
- Nessun commit/push senza richiesta esplicita.
- Nessuna dipendenza nativa nuova; sola lettura sul vault.
- Embedding su CPU senza GPU (vedi #r2): lavoro in sequenza, senza saturare RAM/CPU.
- I segreti nelle note non devono finire in git: indice fuori da git, `.vaultignore`.

## Rischi noti
- Tempo di embedding su vault grandi: coperto dalla stima prima della conferma.
- Allegati e PDF: fuori ambito (solo `.md`).
- Coseni compressi di e5-small: soglia da tarare sul vault reale.

## Decisioni di sviluppo (20 ott)
- BM25 tenuto (misurato). Un chunk entra da BM25 solo con una parola rara (al massimo 3% dei chunk): senza, le parole comuni italiane davano rumore.
- Pavimento coseno = pavimento del modello + 0.06 (e5-small: fuori tema 0.80-0.81, pertinenti 0.875+). Calibrato su pochi punti.
- Stima tempo: 5 sezioni/s (`PI_VAULT_RATE` per cambiarla).
- Tool registrati solo se all'avvio c'è un vault o un CLAUDE.md (niente costo di schema altrimenti).

## Aggiunte del 20 ott (dopo prova su smartlookup-mono)
- `findVault` cerca anche in sottocartelle del cwd (fino a 2 livelli, es. `repo/vault/`): il vault di smartlookup-mono sta in `vault/`.
- Avvio: se ci sono CLAUDE.md o vault con sezioni non indicizzate, `session_start` chiede conferma ("Analizzare CLAUDE.md e il vault?") con la stima; in background, senza bloccare la sessione. Con indice aggiornato non chiede.
- Loader sopra l'editor (`extensions/vault/loader.ts`): spinner, 4 passi (lettura, modello, vettori, salvataggio), barra %, "Sto leggendo: file › sezione", file n/N, tempo e stima restante, Esc per annullare. Test `avvio: conferma, poi loader...` verde.
- BM25: da solo fa entrare un chunk solo con query corte (≤3 parole utili). Misure in `eval/vault/REPORT.md`.

## Aperto
- Percorso del vault dell'utente (non trovato sul disco: nessun `.obsidian` entro 4 livelli dalla home): senza, manca la prova su un vault reale e la ricalibrazione della soglia.
- Sessione pi interattiva reale (footer, conferma, ricerca dal modello): non ancora provata.
- Stato: `ready` perché altri due intent sono `in-progress` (regola #r47); passa a `in-progress` quando si parte.

## Fonti
- https://www.kevsrobots.com/learn/obsidian_rag/09_incremental_indexing.html
- https://github.com/sweir1/obsidian-brain/blob/main/docs/embeddings.md
- https://github.com/Amanaakash/Obsidian-RAG-with-Claude-mcp
- https://blakecrosley.com/guides/obsidian


## Aggiunte del 20 ott (sera)
- Ricerca per nome file, filtri tag/folder, link e backlink in `vault_read`, avviso indice vecchio, tool attivi solo con indice (risparmio token).
- Loader a schermo intero (`loaderScreen` in `extensions/vault/loader.ts`): titolo con gradiente, barra aurora animata, passi, statistiche, sparkline, feed file. Esc annulla, Invio/B in background (poi widget piccolo). Test: dimensioni esatte a 120x40, 80x24, 40x12. Non ancora visto in un terminale reale.
