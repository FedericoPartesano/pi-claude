# Ricerca
Aggiornato: 2026-11-09 · fase 2

Tre domande ricavate dal brief (decisioni 5, 11, 12, 17). Fonti: documentazione di Pi installata (`@earendil-works/pi-coding-agent/docs/extensions.md`), codice del repo, `claude auto-mode defaults` (Claude Code installato), [A2] del territorio, misure locali su WSL (2026-11-09). Nessuna chiamata al modello: zero quota.

## R1 — Una sessione nuova per ogni passo: come, in Pi

- `ctx.newSession({ parentSession, setup, withSession })` esiste solo nel contesto dei **comandi** (`ExtensionCommandContext`), non negli handler degli eventi. — `extensions.md` §ctx.newSession, §ExtensionCommandContext (riga ~1318).
- Da un evento si arriva a un comando con `pi.sendUserMessage("/auto-next", { expandPromptTemplates: true })` in `agent_settled`: il testo viene eseguito come comando. Pattern documentato (esempio `reload-runtime`). — `extensions.md` ~riga 1559.
- Il cambio di sessione **smonta il runtime**: `session_shutdown`, tutte le estensioni rifanno `session_start`; il vecchio `ctx` e il vecchio `pi` sono inutilizzabili. — `extensions.md` §Session replacement lifecycle.
- Nel bridge, `session_shutdown` chiama `disposeAllSessions()`: ogni passo apre un **nuovo processo `claude -p`** (avvio a freddo). Con storia vuota non scrive file di resume. — `pi-claude-code/index.ts:76`, `src/provider.ts:290–330`.
- Il bridge usa `process.cwd()` come cwd di `claude`: un Pi avviato nel repo principale non può lavorare in un worktree cambiando solo la sessione. Il passo deve girare in un processo con cwd = worktree. — `src/provider.ts` (`const cwd = process.cwd()`).
- Alternativa già nel repo: `pi-team/src/runner.ts:41–51` lancia `pi --mode json -p --no-session --provider claude-code --model …` come processo figlio, con `cwd` a scelta. Un figlio per passo dà contesto nuovo, cwd del worktree e lascia intatta la sessione dell'utente.
- Cache del prompt: il prompt di sistema è identico tra un passo e l'altro, ma la cache dura 5 minuti; il costo reale per passo (avvio e lettura dello stato) non è misurato.

## R2 — Permessi: dove si aggancia, cosa bloccare, come spegnere la rete

- Gancio: `pi.on("tool_call")` può **bloccare** (`{ block: true, reason, terminate? }`) o **modificare** l'input prima dell'esecuzione; un errore nell'handler blocca (fail-safe). Vale anche per le chiamate annidate (codemode) tramite `parentToolCallId`. — `extensions.md` §tool_call (~971–1031), riga 3233, riga 813.
- Regole di Claude Code auto mode (`claude auto-mode defaults`, letto il 2026-11-09): 17 eccezioni consentite, **72 regole soft_deny**, 1 hard_deny (Data Exfiltration), 21 voci di ambiente. Gran parte delle soft_deny riguarda cloud, cluster, produzione e browser, non applicabili qui. Quelle locali e sintattiche si traducono in regole: Git Destructive, Irreversible Local Destruction, Credential Exploration, Safety Bypass Flag, Security Test Removal, Self-Modification, Session Transcript Tampering, Unauthorized Persistence, Code from External, Package Registry Bypass, Merge Without Review. Tra le eccezioni utili: Declared Dependencies (installare ciò che il manifest dichiara, purché non modificato nella sessione), Git Push Destination (push sul branch della sessione).
- Una lista nera si aggira con un interprete (`node -e`, `python -c`), e Claude Code stesso toglie le regole sugli interpreti entrando in auto mode. — [A2]
- **Rete spenta a costo zero su Linux/WSL**: `unshare -rn <cmd>` funziona senza privilegi su questa macchina. `git status` va, i file creati restano di `fede`, `curl` e `https.get` di Node falliscono (`EAI_AGAIN`), sovraccarico non misurabile (0,00 s su 3 prove). Questo chiude anche l'aggiramento con `node -e`: niente rete da nessun interprete. Il `tool_call` può riscrivere il comando bash in `unshare -rn sh -c '…'`. — misura locale 2026-11-09. Su macOS: `sandbox-exec` (da verificare); su Windows nativo: nessun equivalente trovato.
- `bwrap` è installato (`/usr/bin/bwrap`): una sandbox del filesystem sarebbe possibile su Linux, con lo stesso limite di piattaforma.
- Classificatore già pronto: il bridge passa `--allowedTools mcp__pi`, quindi Claude Code approva tutte le chiamate ai tool di Pi (`src/claude-session.ts:131`). Con `--permission-mode auto` e senza quella regola, il classificatore di Claude Code valuterebbe i comandi di Pi come «external tool integrations» (tier 3 di [A2]). Non è provato: servono chiamate vere (quota) per sapere se in `-p` il blocco torna come errore del tool e quanto consuma.

## R3 — Worktree e notifiche

- `git worktree add` di questo repo: 0,92 s, 58 MB (1856 file tracciati). I `node_modules` sono 2,7 GB in 7 cartelle e non si possono reinstallare per ogni goal: con un symlink per cartella, `tsc -p pi-ui` passa (5,2 s) e i test `goal.test.ts` e `inflight.test.ts` passano (19/19). — misura locale 2026-11-09.
- `extensions/land/land.ts` gestisce già i worktree (`git worktree list --porcelain`) e una coda di atterraggio con un lock nel git dir condiviso: è riusabile per la proposta di merge.
- Notifica da WSL: `powershell.exe -NoProfile -NonInteractive` parte in 0,51 s (2 prove), avviabile senza attendere la fine. Che la notifica si veda davvero va provato dall'utente su Windows.

## Gate
- Affermazioni portanti: 12, con fonte recuperata davvero: 12 (documentazione e codice letti, comandi eseguiti, [A2] scaricato).
- Contro-evidenza cercata per: «la lista nera basta» (trovata: interpreti, [A2]); «`unshare` rompe git o i permessi» (non trovata); «i worktree costano troppo» (non trovata, con i symlink); «`newSession` basta per i passi» (trovata: cwd del bridge e runtime smontato).
- Famiglie di fonti: 4 (documentazione Pi, codice del repo, Anthropic/Claude Code, misure locali).
- unknown dichiarati: costo reale di un passo a contesto nuovo (avvio `claude -p` e rilettura dello stato); comportamento e costo di `--permission-mode auto` sui tool MCP del bridge; isolamento di rete su macOS e Windows nativo; visibilità della notifica Windows.
