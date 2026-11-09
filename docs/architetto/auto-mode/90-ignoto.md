# Ignoto
Aggiornato: 2026-11-09 · fase 6 · chiuso

| # | Voce | Origine | Stato |
|---|---|---|---|
| 1 | Costo di un worktree per goal: `node_modules` (pi-ui, pi-memory, pi-claude-code) da reinstallare o collegare, modello e5 condiviso | intervista Q6 | risolto (10-ricerca R3: 0,92 s, 58 MB, `node_modules` con symlink, test verdi) |
| 2 | Come si misura «7 casi su 10» senza consumare troppa quota: banco di goal reali e costo per goal | intervista Q2 | differito: si misura sul banco `eval/auto/` dopo la costruzione (ADR 0001, cosa non sappiamo) |
| 3 | Chi garantisce che i check scritti da Pi non siano deboli apposta (si dà ragione da solo) | cosa non sto chiedendo | risolto (brief, decisione 9) |
| 4 | `doubt-driven-development`: costo in token e tempo per decisione (riga 10 di agent-skills-integrate) | agent-skills-integrate | differito: si misura sul banco, con e senza DDD |
| 5 | Quali limiti di guards bastano davvero contro prompt injection da web/file (lista nera vs lista bianca) | intervista Q15 | risolto: ADR 0001 (`bwrap` dove c'è + lista nera + rete spenta) |
| 6 | Notifica Windows da WSL via `powershell.exe`: latenza e affidabilità | intervista Q17 | differito: prova dell'utente su Windows durante l'implementazione |
| 7 | Prompt della fase build contro implementazioni duplicate («non dare per scontato che non esista») | territorio | differito all'implementazione: riga nel prompt della fase build |
| 8 | Goal «impossibile» nel banco per misurare il cheating sui check | territorio | differito (con il banco `eval/auto/`) |
| 9 | 7/10 su goal di mezza giornata forse oltre l'orizzonte attuale dei modelli (METR) | territorio | differito (si misura col banco) |
| 10 | Costo reale di un passo a contesto nuovo: avvio di `claude -p` + rilettura dello stato | ricerca | risolto in parte: prefisso 4 554 token per turno, avvio 4,4–6,6 s (M1, `30-alternative.md`); costo di un goal intero in ADR 0001 (si misura sul banco) |
| 11 | `--permission-mode auto` di Claude Code sui tool MCP del bridge: blocca davvero? quanto costa? | ricerca | risolto, non pertinente: nella B i tool li esegue Pi nel figlio; i permessi stanno in `tool_call` e `bwrap`, non in Claude Code |
| 12 | Isolamento di rete su macOS (`sandbox-exec`) e Windows nativo | ricerca | in ADR 0001 (cosa non sappiamo ancora) |
| 13 | Timeout e retry per passo: senza, il ciclo si blocca (snarktank #32, orchestrator #105) | repo-scouting | risolto: ADR 0001 (timeout del figlio come `AGENT_TIMEOUT_MS`) |
| 14 | Lo stato su disco nel worktree è input non fidato: va validato, mai eseguito (frankbria #371) | repo-scouting | differito all'implementazione: `auto/*.json` letti con validazione di schema, mai eseguiti |
| 15 | Goal banale o «niente da fare»: deve terminare subito (orchestrator #157) | repo-scouting | differito all'implementazione: piano vuoto → arresto con motivo tipizzato «niente da fare» |
| 16 | A: `newSession` non ha cwd, il bridge usa `process.cwd()`; lavorare nel worktree richiede `process.chdir` del Pi dell'utente (S2) | tradeoff | risolto: M3, i tool restano nel repo principale → A esclusa |
| 17 | Ripresa dopo crash di Pi o `/custom-reload` durante un passo (A, B) e avvio staccato su macOS/Windows (C) | tradeoff | in ADR 0001 (C rimandata; ripresa idempotente da `/auto resume`) |
| 18 | Completamento: `goal.ts` rilegge i check dall'intent e accetta prove da 12 caratteri; il supervisore deve congelarli (hash) e calcolare `passes` dagli esiti | tradeoff (critici) | in ADR 0001 (check congelati con hash, `passes` calcolato dal supervisore) |
| 19 | Filesystem fuori dal worktree: `bwrap` per comando chiude scritture e rete in 0,04 s (M5) su Linux/WSL; rivedere lo scarto «sandbox» di N3? | tradeoff (critici) | risolto: ADR 0001 (`bwrap` per comando dove c'è) |
| 20 | Figlio orfano dopo `/custom-reload` o chiusura di Pi: kill del gruppo di processi e resume idempotente | tradeoff (critici) | in ADR 0001 (kill del gruppo di processi, resume idempotente) |
