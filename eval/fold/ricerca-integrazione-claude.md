# Ricerca: come integrare billion-context con Claude Code

Data: 2026-11-23. Ricerca sul web, senza misure nuove. I numeri della strada 1 vengono da `REPORT.md` §6 e dal banco del pagliaio (`haystack/`).

## Domanda

Qual è il modo migliore di avere una compressione del contesto «alla billion-context» quando il modello gira dentro il binario ufficiale `claude` con l'abbonamento, pilotato da Pi tramite il bridge `pi-claude-code`? Ci sono alternative?

## Topologia

```
Pi ── bridge pi-claude-code ── claude -p (stream-json, figlio) ── api.anthropic.com
```

I tool li esegue Pi, tramite il server MCP del bridge. Il figlio parla direttamente con Anthropic, usando l'OAuth dell'abbonamento.

## Fatto chiave dalla fonte primaria

L'autore di billion-context ha già studiato proprio questa topologia («pi-claude-bridge»), nella issue #1468 [1]. Quella issue è stata chiusa come NOT_PLANNED. La discussione continua nella #1392, e la posizione ufficiale del progetto è non toccare le sessioni del bridge.

- **Strada A, `HTTPS_PROXY` con intercettazione TLS:** scartata. Il fetch di Claude Code (undici) ignora `HTTPS_PROXY` [1].
- **Strada B, `ANTHROPIC_BASE_URL=http://127.0.0.1:<porta>/bili/https://api.anthropic.com`:** funziona; secondo la issue è stata provata da capo a fondo da tre fonti indipendenti [1].
  - Il percorso `/bili/` identifica già la sessione.
  - Resta aperto il problema di chi comprime: se comprimono sia il lato Pi sia il proxy, due sistemi lavorano sulla stessa conversazione [1].

Dal README di billion-context [2]:

- Per Claude Code «nativo» esistono `bili plugin install claude` e il plugin del marketplace (`/plugin marketplace add ranxianglei/billion-context`). Il plugin scrive un blocco gestito in `~/.claude/settings.json` con questi elementi:
  - `ANTHROPIC_BASE_URL` puntato al proxy;
  - `DISABLE_AUTO_COMPACT=1`;
  - un hook `SessionStart`.
- Con un base URL personalizzato, Claude Code tratta la sessione come se fosse di terze parti. Le funzioni legate all'account, come Remote Control, spariscono; la compressione invece funziona (#4693).

## Alternative

### 1. billion-context-pi dentro Pi (scelta attuale)

È il modello a decidere cosa comprimere, con i tool `compress`, `decompress` e `search_context`. Pi manda poi una storia più corta, e il bridge riparte con `--resume` sul transcript riscritto.

- Misurato:
  - run N: costo pesato −10,6% contro off;
  - pagliaio H1: circa −13% per turno, in corso.
- Costo: ogni compressione apre una nuova sessione `claude`, cioè un avvio e una nuova scrittura della cache.
- Da qui veniva anche la perdita di processi corretta con `closeOrphaned` in `pi-claude-code/src/idle-reaper.ts`.
- Rispetta i vincoli: binario ufficiale e traffico non toccato.

### 2. Proxy `bili` sul traffico del figlio (strada B)

- Pro:
  - comprime senza riavviare `claude`;
  - è pensato per preservare la cache.
- Contro:
  - il traffico dell'abbonamento passa da un proxy locale che riscrive le richieste, in conflitto con il principio del progetto «binario ufficiale, niente spoofing»;
  - Claude Code tratta la sessione come di terze parti (perde Remote Control);
  - va spento billion-context-pi lato Pi, altrimenti due sistemi comprimono la stessa conversazione;
  - Pi non vede più la storia compressa, quindi l'archivio e il recall dell'estensione `archivio` non si allineano più.
- Prova a costo zero, se si accetta il principio: lanciare Pi con la variabile qui sopra e billion-context-pi spento, sul banco `haystack/`.

### 3. Strumenti nativi di Claude Code [3][4]

- `PreCompact`: il suo stdout diventa istruzioni per il riassunto; può anche bloccare la compattazione automatica.
- `PostCompact`: riceve `compact_summary`.
- `PostToolUse` con `updatedToolOutput`: sostituisce l'output di qualunque tool prima che il modello lo legga (da v2.1.121). L'originale non resta nel transcript.
- Microcompact interno: sostituisce i vecchi risultati di Read, Bash, Grep e simili con dei segnaposto [5].

Per noi servono a poco:

- i tool li esegue Pi, quindi il loro output è già accorciato prima (lean-tools);
- l'auto-compact è spento;
- nessuno di questi strumenti fa scegliere al modello cosa comprimere, né permette di riaprire quello che è stato compresso.

### 4. Context editing via API [6][7]

`clear_tool_uses` e simili funzionano solo con chiave API, non con l'abbonamento tramite `claude -p`. Scartato.

## Confronto: la nostra integrazione e il plugin ufficiale per Claude Code

Fonti: `docs/technical-notes.md` di billion-context, sezioni «Claude native posture» e «Two compression modes»; `commands/bili-setup.md`; `.claude-plugin/plugin.json` (v0.1.216). Il confronto si basa sulla lettura del codice: il plugin ufficiale non è ancora stato provato qui.

- **Versione.** Noi usiamo `billion-context-pi@0.1.83`, fissata in `scripts/setup.mjs`. Il plugin ufficiale è a `billion-context@0.1.216`.
- **Dove avviene la compressione.**
  - Noi: un'estensione dentro Pi. Il modello chiama `compress` come tool di Pi attraverso l'MCP del bridge, e la chiamata resta nella storia di Pi.
  - Ufficiale: il proxy locale `bili` riscrive ogni richiesta `/v1/messages` («proxy mode»). Il proxy esegue `compress` e inserisce nella richiesta lo strumento e i nudge. Il riassunto viaggia come messaggio utente `acp_summary`. Il transcript di `claude` resta intero, e la richiesta viene accorciata solo prima di essere inviata.
- **Processi `claude`.**
  - Noi: dopo un `compress` la storia cambia, quindi il bridge apre una nuova sessione con `--resume`, che comporta una nuova scrittura della cache. Da qui veniva anche la perdita di processi corretta con `closeOrphaned`.
  - Ufficiale: nessun riavvio; il processo resta vivo e la cache viene gestita dal proxy.
- **Rete di sicurezza.** L'ufficiale ha un `preflight` che comprime «alle spalle» del client quando la richiesta da sola supera la finestra. Noi abbiamo la troncatura d'emergenza dell'acp-kernel (`truncate.threshold` 0,95).
- **Prompt e soglie.**
  - Noi: profilo vB snello (`scripts/acp-profile.json`):
    - sezioni tier 2/3 spostate nei nudge;
    - `modelContextLimit` 100000;
    - `preserveRecentTools: ["read"]`;
    - `compress.minPressureBenefitTokens` 30000.
  - Ufficiale: prompt e soglie predefiniti del proxy, a meno di configurarli in `~/.bili`.
- **Memoria e recall.**
  - Noi: il ponte con `archivio` (`foldedIds`, `keyRecall`, `factRecall`, `constRecall`) e la coordinazione con caveman e lean-tools.
  - Ufficiale: niente di tutto questo. Pi vedrebbe la storia intera e non saprebbe cosa è stato compresso.
- **Impostazioni di Claude Code.** Il plugin ufficiale scrive in `settings.json`:
  - `ANTHROPIC_BASE_URL` puntato al proxy locale;
  - `DISABLE_AUTO_COMPACT=1`;
  - un hook `SessionStart` che avvia il proxy;
  - un server MCP `bili` (`acp_status`, `acp_cache`…);
  - il comando `/acp-cache`.

  Noi non tocchiamo `~/.claude`.
- **Account e traffico.**
  - Noi: traffico e OAuth dell'abbonamento intatti, e Remote Control funziona.
  - Ufficiale: il traffico passa dal proxy che riscrive le richieste; Claude Code tratta la sessione come se fosse di terze parti, e Remote Control sparisce (#4693).
- **Uso con Pi.** Per usare l'ufficiale con Pi va spento billion-context-pi, altrimenti due sistemi comprimono la stessa conversazione (issue #1468).
- **Misure.**
  - Noi: −10,6% di costo pesato (run N); circa −13% per turno sul pagliaio H1.
  - Ufficiale: nessuna misura nostra.
- **Prova isolata.** Con `CLAUDE_CONFIG_DIR=/tmp/bc-claude` Claude Code risponde «Not logged in»: il login dell'abbonamento è legato alla cartella di configurazione, quindi serve un `/login` fatto dall'utente in quella cartella.

## Prova del plugin ufficiale (cartella isolata)

- Installazione: `npm install -g billion-context@0.1.216 --prefix=/tmp/bili-pkg`, poi `bili plugin install claude` con `CLAUDE_CONFIG_DIR=/tmp/bc-claude` e `XDG_{CONFIG,DATA,CACHE}_HOME=/tmp/bili-xdg/*`. `~/.claude` non è stato toccato.
- Cosa scrive in `settings.json`:
  - `env.ANTHROPIC_BASE_URL=http://127.0.0.1:18787/bili/https://api.anthropic.com`;
  - `env.DISABLE_AUTO_COMPACT=1`;
  - gli hook `SessionStart` (avvio del proxy) e `SubagentStart`.
- Altri file: il comando `commands/acp-cache.md` e il server MCP in `.claude.json`.
- Funziona con l'abbonamento: `claude -p` (haiku) risponde e `/__bili/stats` registra la sessione.
- Costo fisso, misurato su una richiesta minima haiku (input + cache), 2 ripetizioni identiche:
  - proxy attivo: 25.209 token;
  - passthrough (`BILI_NATIVE_CLAUDE=0`): 20.915 token;
  - differenza: +4.294 token a richiesta, simile al nostro +4.519 (31.103 contro 26.584, misurati su Pi).
- Manca ancora la misura sul banco `haystack/` (Pi con billion-context-pi spento e figlio `claude` nella cartella isolata).

## Conclusione

Resta la strada 1. Miglioramenti possibili, tutti da misurare:

- raggruppare più `compress` in un solo riavvio di `claude`, per ridurre avvii e scritture della cache;
- rimisurare `closeOrphaned` sul pagliaio da 158 turni.

La strada 2 si prova solo se l'utente accetta che il traffico dell'abbonamento passi da un proxy che riscrive le richieste.

## Fonti

1. ranxianglei/billion-context, issue #1468, «Taking over pi-claude-bridge traffic» (2026-09-27): https://github.com/ranxianglei/billion-context/issues/1468
2. ranxianglei/billion-context, README (sezioni «claude» e «native posture»): https://github.com/ranxianglei/billion-context ; dettagli in docs/technical-notes.md: https://github.com/ranxianglei/billion-context/blob/HEAD/docs/technical-notes.md
3. Claude Code, Hooks reference (PreCompact, PostCompact, PostToolUse `updatedToolOutput`): https://code.claude.com/docs/en/hooks
4. Agent SDK, Intercept and control agent behavior with hooks: https://code.claude.com/docs/en/agent-sdk/hooks ; contesto: https://github.com/anthropics/claude-code/issues/32105
5. Analisi del microcompact (fonte secondaria): https://harrisonsec.com/blog/claude-code-context-engineering-compression-pipeline/ ; https://blog.chanler.dev/en/posts/tech-learn/claude-code-context-management
6. Anthropic, Context editing: https://platform.claude.com/docs/en/build-with-claude/context-editing
7. Claude Cookbook, Context engineering: memory, compaction, and tool clearing: https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools

## Issue e discussioni upstream sulla decompressione (2026-11-23)

Ricerca con `gh search issues "decompress"` in `ranxianglei/billion-context`, `billion-context-pi` e `acp-kernel`, più le discussioni dei primi due.
- Fedeltà degli originali: billion-context#6834 (p1, aperta, PR #6852 in attesa): dopo un troncamento d'emergenza si salva come originale la vista troncata. billion-context-pi#593: le immagini non tornano. #582 e #603: blocchi `live-*` e fork non recuperabili. Nella nostra misura (H1-bc-rn) nessuno di questi casi.
- Riassunti: billion-context#6927, segnalata proprio su billion-context-pi 0.1.83. Il kernel accetta riassunti troncati a metà parola o troppo corti per il range, e `compress.minSummaryLength` in `acp.json` non ha effetto. Fix in acp-kernel#521 e billion-context-pi#694, non ancora rilasciati.
- Costo di `inline`: billion-context#5013, nessun controllo di dimensione prima di un restore grande. #4080: oltre 10k caratteri il restore va su file e il percorso di refold si rompe. billion-context-pi#359: economia della cache delle ripiegature.
- Comportamento del modello: billion-context-pi#572, il modello decomprime subito dopo aver compresso perché crede il riassunto tagliato. #399: il pacchetto lean rende `search_context` un richiamo di routine. #470: rilavoro dopo il compress.
- Nessuna issue o discussione misura quanto la decompressione recuperi nei quiz di richiamo come facciamo noi.
- Stato del pacchetto: la discussione billion-context-pi#671 («Deprecated?», 2026-10-31) non ha risposta. La issue #633 dice che lo sviluppo continua in billion-context. 0.1.83 è ancora l'ultima versione su npm.
