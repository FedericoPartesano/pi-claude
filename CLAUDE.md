# pi-claude

Pi (earendil-works/pi) con i modelli Claude tramite l'abbonamento Claude Code: il bridge pilota il binario ufficiale `claude`, niente API Anthropic con OAuth, niente spoofing. Tutto è un unico pacchetto Pi (`package.json` → `pi.extensions`).

## Struttura
- `pi-claude-code/` — provider Pi: `claude -p` persistente (stream-json) con bridge MCP in lockstep; i tool li esegue Pi.
- `pi-ui/` — chat "Neon Night": barra di stato, passi compatti, immagini, suggerimenti, pannello.
- `pi-picker/` — picker modale (file, cartelle, progetti recenti).
- `pi-team/` — team di sub-agenti con orchestratore.
- `pi-memory/` — memoria profonda (`/dream`, `/ricorda`), embedder locale (`pi-memory/src/embed.ts`).
- `extensions/` — estensioni singole (intent, goal, loop, lean-tools, caveman, graph, vault, bug, guards…), ognuna con il suo `*.test.ts`.
- `intents/` — intent del progetto (`status: draft|ready|in-progress|done|rejected`).
- `eval/`, `bench/` — valutazioni e benchmark con i report (`eval/REPORT.md`, `bench/RESULTS.md`).
- `vault/` — wiki del progetto (vault Obsidian) secondo la convenzione [llm_wiki](https://github.com/nashsu/llm_wiki), indicizzata da `extensions/vault`. Vedi la sezione Wiki.
- `upstream/` — clone di Pi, fuori da git, solo come riferimento.

## Comandi
- Test mirati: `node scripts/t.mjs [--watch] [nome…]` lancia solo i test dei file modificati (git) o `extensions/<nome>.test.ts`. Suite completa solo a fine lotto.
- Prova del prototipo in pty: `python3 -I prototype/rpc-chat/pty.py [--fake eventi.jsonl] [--cols N] PASSO… -- [args chat]` (passi: testo, `key:down|up|enter|esc|tab`, `sleep:S`); stampa lo schermo finale. `prototype/rpc-chat/fake/pi` è il Pi finto.
- Test di un'estensione: `node --test extensions/<nome>.test.ts` (Node ≥ 22.19, TypeScript eseguito direttamente).
- Typecheck del bridge: `cd pi-claude-code && npx tsc -p .` (non c'è un tsconfig alla radice).
- Installazione locale: `./install.sh` (rilanciabile dopo `git pull`).

## Wiki (`vault/`)
Le regole sono in `vault/schema.md` (tipi di pagina, nomi, frontmatter, formati di index e log) e gli obiettivi in `vault/purpose.md`: leggili prima di toccare la wiki.
- `vault/raw/` — fonti immutabili: si leggono, non si modificano mai.
- `vault/wiki/` — pagine scritte dal modello: `entities/`, `concepts/`, `sources/`, `queries/`, `comparisons/`, `synthesis/`, più `index.md`, `log.md`, `overview.md`.
- Ingest: pagina in `wiki/sources/`, aggiorna entità e concetti toccati, `wiki/index.md`, voce `## [YYYY-MM-DD] ingest | Titolo` in testa a `wiki/log.md`.
- Query: parti da `wiki/index.md` o `vault_search`; le risposte utili tornano nella wiki come pagine.
- Lint: link rotti, pagine orfane, contraddizioni, affermazioni superate; esito nel log.

## Convenzioni
- Lingua: italiano per documenti, intent, messaggi all'utente e commit; commenti nel codice in inglese.
- Commit in Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`…): solo `feat` e `fix` entrano nel changelog. La versione la gestisce release-please: non modificarla a mano.
- Nessun commit o push senza richiesta esplicita.
- Mantra di Pi, in ordine: 1) risparmio di token, al primo posto (prompt fisso corto e stabile per la cache, iniezioni brevi, niente contesto inutile, tool spenti finché non servono; ogni funzione si valuta prima per i token che costa); 2) velocità e leggerezza, sempre. Ogni funzione o rifinitura si progetta prima per CPU, memoria e latenza (niente lavoro per frame, niente timer inutili, stringhe statiche in cache); se costa troppo si ottimizza o si disattiva, e si rimisura (`prototype/rpc-chat/perf.test.mjs`, Proxmox).
- Le estensioni importate da altre vanno registrate col percorso reale: Pi non segue i symlink negli import relativi.
- Ogni affermazione su prestazioni o qualità va misurata e riportata in un report (`eval/`), anche se negativa.
