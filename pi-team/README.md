# pi-team

Team di sub-agenti specializzati guidato dal manager (la sessione Pi principale).
Il modello scrive il piano; il codice garantisce checkpoint, verifica empirica, tentativi e budget.

## Uso
```bash
pi-full                          # già caricato
pi -e ~/documents/projects/pi-claude/pi-team
```
Chiedi un lavoro in più parti ("usa il team per …"). Il manager chiama il tool `team` con un piano:
ti viene chiesto di approvarlo, poi il team lavora e restituisce un report verificato.

## Come funziona
1. **Piano** (dal modello): compiti con ruolo, dipendenze e comandi di verifica; validato (ruoli esistenti,
   niente cicli, verifica obbligatoria per chi modifica file).
2. **Checkpoint**: approvazione dell'utente (`PI_TEAM_AUTO_APPROVE=1` per esecuzioni automatiche).
3. **Esecuzione**: ogni agente è un processo `pi` (provider claude-code) con modello, tool e istruzioni del ruolo;
   ruoli in sola lettura in parallelo, chi scrive uno alla volta; parallelismo dalla finestra 5h dell'abbonamento
   (<50% → 3, <70% → 2, <90% → 1, oltre o extra usage → non parte).
4. **Verifica**: i comandi li esegue il codice; se falliscono il compito torna all'agente con l'errore (max 3).
   Verifica finale con giri correttivi (max 2), poi il revisore. **Decidono i test**: il report è VERIFICATO
   solo se i controlli finali passano.

## Ruoli (`roles/*.md`, override in `~/.pi/agent/team/roles/`)
| Ruolo | Modello | Tool | Scrive |
|---|---|---|---|
| scout | haiku | read, bash | no |
| implementer | sonnet | read, bash, edit, write | sì |
| tester | sonnet | read, bash, edit, write | sì |
| reviewer | sonnet | read, bash | no |

## Test
`npm test` (unitari, runner e verifiche finti) · `npx tsc -p .` · valutazione empirica: `../eval/team-cases.mjs`.

## Consigliere: Pi da solo o team?
In `pi-full`, prima di ogni richiesta, un punteggio locale istantaneo (nessuna chiamata al modello) valuta il lavoro:
parti distinte (elenchi, anche numerati sulla stessa riga), aree o moduli toccati, parole da lavoro ampio
("migrazione", "tutto il progetto"…), richiesta di revisione indipendente, contesto della sessione già pieno;
penalità per richieste brevi e per le domande.
- Sotto la soglia (5): nessuna interruzione, Pi da solo.
- Sopra la soglia: domanda "Usare il team?" con punteggio e motivi. Sì → il messaggio diventa "Usa il tool team…"; No → Pi da solo.
- `/consiglia <lavoro>` mostra la valutazione senza eseguire nulla.

Taratura prudente: i 6 lavori compositi della valutazione (dove il team non ha reso) risultano "Pi da solo" (test).
