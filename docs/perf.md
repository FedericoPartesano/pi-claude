# Misure di prestazioni

Comando: `node scripts/perf-baseline.mjs 20 --json` (Pi in modo RPC con tutto il pacchetto e un Claude Code finto; `--bare` e `--only <estensione>` isolano i pezzi). Mediana di 5 esecuzioni, 2026-10-15.

| Misura | Prima | Dopo | Differenza |
|---|---|---|---|
| RAM totale (Pi + figli) a regime | 1608 MB | 1036 MB | -36% |
| RAM del solo processo Pi | 768 MB | 196 MB | -74% |
| CPU totale di Pi nei primi 25 s | 7,8 s | 3,8 s | -51% |
| Avvio di Pi (prima risposta RPC) | 942 ms | invariato (rumore tra 800 e 1450 ms in entrambi) | 0 |
| CPU a riposo (dopo l'avvio) | 1,6% | 2,0% | già bassa, invariata |

Cause trovate:
- Il modello di embedding (~650 MB) girava in un thread di Pi e, scaricato, restituiva solo 37 MB. Ora vive in un processo figlio (`pi-memory/src/embed-process.ts`) che viene chiuso: la memoria torna al sistema.
- Il modello si caricava a ogni avvio di sessione (~4,4 s di CPU). Ora si carica al primo richiamo che trova vettori; il primo richiamo risponde con le parole chiave. Dopo 3 minuti senza uso (era 10) viene chiuso e si ricarica da solo.
- Pool `claude -p` (~250 MB per processo): le sessioni ferme si chiudono (le altre dopo 5 min, l'ultima dopo 60) e la conversazione riparte dal transcript (`pi-claude-code/src/idle-reaper.ts`).

Non toccato (configurazione utente, non del repo): i server MCP in `~/.pi/agent/mcp.json` (`rea` ~400 MB, `chrome-devtools` via `npx` ~230 MB, `nb` ~90 MB) valgono circa 700 MB e partono a ogni sessione.
