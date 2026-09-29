# pi-claude-code

Provider per [Pi](https://pi.dev) che fa girare i modelli Claude **attraverso la CLI ufficiale di
Claude Code**, quindi sull'abbonamento Claude (Pro/Max) come una normale sessione di Claude Code,
senza API key e senza *extra usage*.

Nessuno spoofing: il processo che parla con Anthropic è il binario `claude` ufficiale. Pi resta
invariato (TUI, sessioni ad albero, estensioni, skill, pacchetti, RPC/SDK).

## Uso

```bash
# prova al volo
~/documents/projects/pi-claude/pi-claude-code/node_modules/.bin/pi \
  -e ~/documents/projects/pi-claude/pi-claude-code --provider claude-code --model sonnet

# oppure installa l'estensione nel tuo Pi globale
pi install ~/documents/projects/pi-claude/pi-claude-code
pi --provider claude-code --model sonnet     # oppure /model dentro Pi
```

Modelli: `claude-code/sonnet`, `claude-code/opus`, `claude-code/haiku` (alias della CLI `claude`).

Requisiti: `claude` installato e loggato con l'abbonamento (`claude` → `/login`), Node ≥ 22.19.

Variabili:
- `PI_CLAUDE_BINARY` — percorso di `claude` (default: `claude` nel PATH)
- `PI_CLAUDE_DEBUG=/percorso/log` — log completo dello stream del bridge

## Come funziona

```
Pi (loop, TUI, sessioni, estensioni)
  └─ provider claude-code (streamSimple)
       ├─ processo `claude -p` persistente, stream-json in/out, --tools "" (niente tool built-in)
       │    system prompt = quello di Pi (--system-prompt-file), --setting-sources "" (niente hook/CLAUDE.md utente)
       └─ server MCP "sdk" dentro Pi (protocollo di controllo dell'Agent SDK sullo stesso stdin/stdout)
          → espone i tool correnti di Pi con i nomi esatti (read, bash, edit, write, + estensioni);
          alternativa HTTP con PI_CLAUDE_MCP_TRANSPORT=http (nomi mcp__pi__<nome>)
```

Lockstep dei due loop: quando Claude chiama un tool, il blocco `tool_use` arriva nello stream →
il provider lo passa a Pi e chiude il messaggio (`stopReason: toolUse`). La richiesta MCP di Claude
Code resta **in sospeso**. Pi esegue il tool (con tutti gli hook delle estensioni) e richiama il
provider con il risultato → il bridge risolve la richiesta MCP → Claude continua, e il suo messaggio
successivo è la risposta alla nuova richiesta di Pi.

- Riuso processo: il bridge tiene le fingerprint del transcript già noto; se il nuovo transcript lo
  estende, invia solo la coda (tool result / messaggi utente).
- Fedeltà: quando nessun processo conosce il transcript (fork, /tree, compaction, cambio
  prompt/tool/modello/thinking, abort) il bridge scrive la storia come **sessione nativa di Claude
  Code** e la riprende con `--resume`: tool_use/tool_result reali, thinking firmato, immagini. Il file
  viene cancellato alla chiusura (`--no-session-persistence` per il resto).
- Steering: i messaggi utente arrivati durante i tool vanno su stdin *prima* di rilasciare i tool
  result → Claude Code li tratta come messaggi utente veri.
- Thinking: livelli di Pi → `--effort` (off → thinking disattivato); riassunti del thinking in
  streaming (`--thinking-display summarized`).
- Contesto minimo: nessun hook/CLAUDE.md/memoria/skill/git/autocompact di Claude Code
  (`--setting-sources ""` + variabili `CLAUDE_CODE_DISABLE_*`, `DISABLE_AUTO_COMPACT`). I tool MCP
  dichiarano `anthropic/maxResultSizeChars` alto, così Claude Code non sposta su file i risultati
  grandi (Pi tronca già da sé). `--bare` NON si usa: forzerebbe l'autenticazione via API key.

## Limiti noti
- Overhead residuo di Claude Code ~400 token per richiesta (una riga di identità + promemoria di
  ambiente/modello/data/utente), non disattivabile senza `--bare`.
- Dopo un resume la cache riparte per la parte di storia (system prompt e tool restano in cache).
- Il modello tende a preferire bash a read/edit (vedi `../eval/REPORT.md`, BUG-2; mitigazione opzionale `PI_CLAUDE_TOOL_NOTE=1`).
- Argomenti tool con JSON non valido (tab letterali): gestiti come Claude Code (errore al modello, che riprova), costano 1 richiesta in più.
- Costi mostrati a 0 (abbonamento); i token nel footer sono reali.

## Test

```bash
cd pi-claude-code
npx tsc -p .                                            # typecheck
# bridge con claude finto (deterministico, senza rete)
PI_CLAUDE_BINARY=$PWD/test/fake-claude.mjs node test/rpc-driver.mjs "READ:/etc/hostname" "ciao"
# claude vero
node test/rpc-driver.mjs "Leggi /etc/hostname" "/compact" "!fork:0" "!steer:5000:msg|prompt" "!abort:3000:prompt" "!stats"
node test/rpc-driver.mjs --ext test/block-rm-extension.ts "Esegui rm /tmp/x"
```

Risultati dei test empirici: vedi `../NOTES.md`.
