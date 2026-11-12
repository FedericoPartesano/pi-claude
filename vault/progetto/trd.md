---
stato: bozza
---
# TRD — pi-claude

- Linguaggi: TypeScript eseguito direttamente da Node ≥ 22.19 (estensioni, bridge); prototipo della chat in JavaScript `.mjs` senza dipendenze; script di prova in Python (`pty.py`).
- Pacchetto: un unico pacchetto Pi (`package.json` → `pi.extensions`, temi, skill). Versione gestita da release-please.
- Dipendenze runtime: `@huggingface/transformers` (embedder locale e5), `jpeg-js`, `pngjs`. Dev: `typescript`.
- Modelli: binario ufficiale `claude -p` persistente (stream-json) con bridge MCP in lockstep; i tool li esegue Pi.
- Database: nessuno. Stato su file: JSON di stato e diario `*.eventi.jsonl` di `/auto` fuori dalla worktree, sessioni Pi, vault Markdown, indice memoria locale.
- Login: quello di Claude Code (abbonamento); il progetto non gestisce credenziali.
- Pagamenti: nessuno. Hosting: nessuno, tutto locale (`install.sh`); misure su Proxmox.
- Integrazioni: Pi (`pi --mode rpc` per il prototipo), Claude Code, git/worktree (`auto/<slug>` in `<repo>-auto/`), Obsidian (vault), browser/Chrome (estensione `browser`).
- `/auto`: supervisore nella sessione Pi, un processo figlio per passo (ADR 0001); il cockpit legge file e `fs.watch`, zero token.
- Test: `node --test extensions/<nome>.test.ts`, `node scripts/t.mjs`, `tsc -p` per bridge e pi-ui, `perf.test.mjs` per le prestazioni.
