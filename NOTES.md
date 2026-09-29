# pi-claude — Pi su abbonamento Claude Code

Obiettivo: usare Pi (earendil-works/pi, MIT) con i modelli Claude **tramite l'abbonamento**,
pilotando il binario ufficiale `claude` invece delle API Anthropic con OAuth (che Anthropic
fattura come *extra usage* per harness di terze parti). Niente spoofing di token/header.

- `upstream/` = clone di Pi @ `8676a0d` (2026-09-24, coding-agent 0.87.1)

## Test di fattibilità `claude -p` (2026-09-24, CLI 2.1.281) — 5/5 PASS

Flag base: `--setting-sources "" --system-prompt-file sys.md --tools Read Write Edit Bash --strict-mcp-config --dangerously-skip-permissions`

| # | Cosa | Esito |
|---|---|---|
| 1 | contesto pulito | nessun hook, `apiKeySource:"none"` (abbonamento), 4 tool, `mcp_servers:[]` |
| 2 | tool loop | Read → Edit → Bash, nessun prompt permessi |
| 3 | processo persistente `--input-format stream-json` | 2 prompt, stesso `session_id`, contesto mantenuto |
| 4 | `--include-partial-messages` | eventi SSE Anthropic raw (`message_start`, `content_block_delta`, …) |
| 5 | `--resume <id> --fork-session` | nuovo id con storia; ramo originale isolato |

Da verificare: `/usage` senza extra usage; steering mid-run; `--tools ""` + tool solo MCP.

## Decisione: estensione, non fork

Pi espone `pi.registerProvider(name, { models, streamSimple })`. `streamSimple` riceve un
`TranscriptContext` normalizzato (system prompt e tool via `getCurrentSystemPrompt` /
`getCurrentTools`) e deve emettere **un** assistant message (text/thinking/toolcall events),
poi `done`. Pi esegue i tool e richiama `streamSimple` con i tool result. Esempio di
riferimento: `upstream/packages/coding-agent/examples/extensions/custom-provider-anthropic/`
(NB: quell'esempio usa l'OAuth diretto → extra usage; noi NO).

Quindi basta un pacchetto estensione (`pi install ./pi-claude-code`), niente fork: resti
allineato agli update di Pi.

## Il nodo: due agent loop

`claude -p` ha il suo loop ed esegue lui i tool; Pi vuole eseguirli lui (eventi `tool_call`,
`tool_result`, estensioni). Soluzione — **bridge MCP in lockstep**:

1. Provider avvia `claude -p` persistente (stream-json in/out, partial messages) con
   `--tools ""` (nessun built-in) + `--mcp-config` verso un server MCP interno all'estensione
   che espone **i tool correnti di Pi** (nome, descrizione, schema TypeBox = JSON Schema).
2. `streamSimple` #1: scrive il prompt utente su stdin, converte gli `stream_event` in eventi Pi.
   Se l'assistant message contiene `tool_use` → emette toolcall, `stopReason: toolUse`, `done`.
3. Claude Code intanto chiama il tool MCP → l'handler **non esegue**, resta in attesa.
4. Pi esegue il tool (con tutti gli hook delle estensioni) → chiama `streamSimple` #2 con il
   tool result → il bridge risolve la chiamata MCP pendente con quel risultato → Claude continua
   → lo stream del messaggio successivo diventa la risposta di #2.

Dettagli da gestire:
- correlazione tool_use (id Claude) ↔ richiesta MCP (nome+args, ordine); tool paralleli
- `MCP_TOOL_TIMEOUT` alto (Pi può metterci molto: bash lunghi, conferme utente)
- nomi tool visti dal modello = `mcp__pi__read` ecc. (accettabile)
- **divergenza contesto** (`/tree`, `/fork`, compaction, cambio system prompt/tool): il bridge
  confronta il transcript atteso con quello ricevuto; se diverge → nuovo processo `claude`
  (`--resume` + `--fork-session` se il punto esiste, altrimenti ricostruzione)
- abort → control request `interrupt` su stdin (da verificare)
- usage/cost da `message_delta.usage` (costo = stima; con abbonamento non addebitato)
- compaction: meglio lasciarla a Pi e disattivare autocompact di Claude Code

## Spike lockstep (2026-09-24) — PASS

`spike/mcp-slow.mjs` + `spike/mcp.json`: MCP stdio che trattiene `tools/call` 30s.
Comando: `MCP_TOOL_TIMEOUT=120000 claude -p ... --tools "" --mcp-config spike/mcp.json --strict-mcp-config --allowedTools mcp__pi__read --setting-sources "" --include-partial-messages --output-format stream-json --verbose`

- `init`: tools = solo `mcp__pi__read` (`--tools ""` disattiva tutti i built-in), server `pi` connected, `apiKeySource:"none"`
- `tool_use` nello stream a 09:38:35, `tools/call` MCP a 09:38:35.859 (quasi simultanei; args completi a `content_block_stop`)
- Claude attende 30s senza errori, poi riprende e risponde → **ipotesi lockstep confermata**
- niente `--dangerously-skip-permissions` necessario (solo tool MCP in `--allowedTools`)

## Estensione `pi-claude-code/` — test empirici (2026-09-24, Pi 0.87.1, claude 2.1.281, sonnet)

Implementazione: `index.ts` (registerProvider `claude-code`, modelli sonnet/opus/haiku),
`src/provider.ts` (streamSimple, pool processi, riuso via fingerprint, seed storia),
`src/claude-session.ts` (processo `claude -p` + lockstep MCP), `src/mcp-http-server.ts`
(MCP Streamable HTTP in-process). Test: `test/fake-claude.mjs`, `test/rpc-driver.mjs`,
`test/block-rm-extension.ts`. Typecheck `npx tsc -p .` pulito.

| Test | Esito |
|---|---|
| claude finto, print + RPC 3 turni | ✅ 1 solo processo, solo messaggi nuovi inviati, `ANTHROPIC_API_KEY` rimossa dall'env |
| claude vero: read / write+bash / memoria 3° turno | ✅ 8.4s totali, 1 processo, tool `mcp__pi__{bash,edit,read,write}`, model `claude-sonnet-5` |
| prompt cache | ✅ turno 2+ legge ~5.1k dalla cache (CH 97.7% nella TUI) |
| `/compact` (47k → 8.7k token) | ✅ memoria (AZZURRO, 3 file) preservata; 2 spawn = chiamate di riassunto di Pi, 1 = sessione nuova |
| steering v1 (messaggio dentro tool result) | ❌ il modello lo tratta come prompt injection e lo ignora (comportamento corretto) |
| steering v2 (stdin prima di rilasciare i tool result) | ✅ dopo lo steer scrive solo pari (1,2,4); lockstep intatto, 1 processo |
| abort durante `sleep 20` | ✅ interrotto; turno dopo sa che non è completato (processo riavviato con storia) |
| `fork` dal 2° messaggio | ✅ conosce GIRASOLE, non TULIPANO; nuovo processo con storia seed, poi riuso |
| hook `tool_call` estensione Pi (blocca `rm`) | ✅ bloccato, file intatto, il modello riceve il motivo |
| TUI interattiva (tmux) | ✅ tool inline, risposta, footer `(claude-code) sonnet` |
| **fatturazione** (`rate_limit_event`) | ✅ `isUsingOverage:false`, `overageStatus:"rejected"`, consumo su finestra `five_hour` 8% / `seven_day` 35% |

## Round 2: contesto minimo + fedeltà (2026-09-24)

Misure:
- overhead puro Claude Code (system prompt 1 riga, zero tool): **~400 token** (419; 396 con
  `CLAUDE_CODE_DISABLE_ATTACHMENTS`). Il resto dei ~5k del primo turno è il prompt di Pi (9.2k char)
  + schemi tool (4.1k char): identico a Pi nativo.
- `--bare` scartato: forza auth API key (= extra usage).

Modifiche + verifiche (claude vero):
| Cosa | Esito |
|---|---|
| resume nativo (`claude-transcript.ts` scrive sessione Claude Code + `--resume`) al posto del seed testuale | ✅ fork: ricorda `ZEBRA-7781` al char 8375 di un tool result (vecchio seed troncava a 4k); ramo corretto (GIRASOLE sì, TULIPANO no) |
| pulizia | ✅ file sessione cancellato alla chiusura, `--no-session-persistence` sugli altri: 27 → 27 file |
| Claude Code spostava tool result grandi su file (anteprima 2 KB) | ✅ risolto con `_meta["anthropic/maxResultSizeChars"]`: il modello vede l'output di Pi (troncato da Pi a 50KB con sua nota offset) |
| thinking: firma catturata (`signature_delta`, `redacted_thinking`), livelli Pi → `--effort`, off → `CLAUDE_CODE_DISABLE_THINKING` | ✅ `--effort high/max` passato; blocchi thinking firmati |
| testo del thinking | ✅ flag nascosto `--thinking-display summarized` (default `omitted` = vuoto): 100 delta di testo |
| cambio modello sonnet → opus a metà sessione | ✅ resume, memoria ok, "Sono Claude Opus 5.5" |
| abort + resume | ✅ sa che sleep 20 non è terminato, parola chiave ok |
| compaction 75k → 28k con resume | ✅ memoria ok (codice nascosto perso nel riassunto = comportamento di Pi stesso) |
| regressione claude finto | ✅ |

Residui non eliminabili: ~400 token di overhead; cache della storia ricreata dopo un resume.

## Setup Pi utente (2026-09-24)

- Pi globale 0.87.1; default `claude-code/sonnet` (prima era `anthropic/claude-opus-4-8` OAuth = extra usage)
- `pi` = minimale: 4 tool base + hook a costo zero `permission-gate` (rm -rf/sudo/777) e
  `protected-paths` (.env, .git/, node_modules/) → primo turno **~5.1k token**
- `pi-full` (`~/.local/bin/pi-full`) = + pi-web-access, rpiv-todo, rpiv-ask-user-question, subagent
  (`~/.pi/agent/optional-extensions/subagent`) → **~12k token**. I pacchetti npm restano installati
  con `"extensions": []` in settings.json.
- agenti subagent in `~/.pi/agent/agents/` con modelli `claude-code/haiku|sonnet`
- `~/.pi/agent/web-search.json`: `summaryModel: claude-code/haiku`

## Round 3: ottimizzazioni (2026-09-24)

- Benchmark vs Claude Code nativo: `bench/RESULTS.md` (Pi −84% input token, −28/37% tempo).
- Avvio a freddo di `claude`: 3–18 s (variabile col carico). `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
  nessun effetto misurabile.
- **Pre-avvio** (`prewarmSession`, index.ts su `session_start`/`model_select`/`thinking_level_select`,
  solo TUI): firma calcolata da `ctx.getSystemPrompt()` + `pi.getAllTools()` (tool ordinati) →
  coincide con la prima richiesta (`reuse=yes (known 0)`); prima risposta **~1.1 s** dopo l'invio
  invece di 5–12 s.
- Prompt Pi (9.055 char): **6.056 = elenco 16 skill di `~/.agents/skills`** (~1.5k token/richiesta) → escluse 12 (settings `skills`), base 3.374 token,
  1.285 docs, 841 rules. Filtro: `"skills": ["-<percorso assoluto skill>"]` in settings.json
  (il glob `!` NON funziona sulle skill auto-scoperte).

## Prossimi passi possibili
- mostrare nel footer di Pi la finestra dell'abbonamento dai `rate_limit_event`
- (opzionale) classifier locale stile Jev via llama.cpp come provider `classifier`

## Valutazione 50 casi (2026-09-24) → `eval/REPORT.md`
- CC 50/50, Pi 47/50 → BUG-1 (JSON tool non valido abortiva il turno) corretto, rerun 16/16.
- Pi −90% input token, −35% tempo; +110% output token.
- BUG-2 aperto: via bridge il modello usa bash invece di read/edit di Pi (147 vs 15); `PI_CLAUDE_TOOL_NOTE=1` aiuta poco.
- `protected-paths` aggirabile via bash; stress compaction automatica ok.
- Round 4: trasporto MCP `sdk` di default (nomi tool senza prefisso, `CLAUDE_AGENT_SDK_MCP_NO_PREFIX`, permessi `mcp__pi`); BUG-2 NON dipende dal prefisso; hook `extensions/protected-paths.ts` bash-aware (BUG-3 risolto); footer abbonamento via `rate_limit_event`; thinking low sbaglia sh05 → resta medium. Pi-sdk: 50/50.
