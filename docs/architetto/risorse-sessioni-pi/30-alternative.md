# Alternative — risorse-sessioni-pi

## A. Tetto a livello WSL (`.wslconfig`)
- Invarianti: WSL non supera X thread e Y GB; Windows ha sempre il resto.
- Seme minimo: `processors=10` (o 8), `memory=16GB` in `C:\Users\<utente>\.wslconfig`, poi `wsl --shutdown`.
- Stato: nel file, fuori dal repo. Evoluzione: si regola a mano.
- Prende da: documentazione WSL.
- Costo: tocca config utente (serve ok); un solo tetto per tutto; test e sessioni si fanno concorrenza dentro il tetto, quindi WSL va comunque al 100% del *suo* tetto; con `memory` troppo basso rischio OOM.

## B. Governo nel repo (semaforo + cgroup per i carichi pesanti)
- Invarianti: al massimo K carichi pesanti insieme sulla macchina; ognuno con tetto di CPU/RAM; i `claude -p` e gli embedder di sessioni inattive già si chiudono.
- Seme minimo: nella tool_call `bash` di Pi, i comandi pesanti (`node --test`, `tsc`, `npm test/build`, `vitest`) passano da un wrapper `heavy-run`: `flock` a K slot su `~/.cache/pi/heavy.N` + `systemd-run --user --scope -p CPUQuota=400% -p MemoryMax=6G` + `nice`/`ionice` + `--test-concurrency=4`. Stesso wrapper per i test lanciati da `pi-team`. `PI_PARALLEL_MAX` di `pi-team` scende da 8 a un valore legato a `os.availableParallelism()`/RAM libera.
- Stato: lock su file in `~/.cache/pi/` (liberato alla morte del processo come in gradle-locked).
- Prende da: gradle-locked (slot, coda, timeout), systemd-run (tetti), shell-tools (nice).
- Costo: lavoro nel repo e test; il comando va intercettato (da verificare se `tool_call` può riscrivere `input.command`); non copre ciò che gli agenti lanciano fuori da Pi (es. `claude --resume` separato).

## C. A + B
- Tetto grosso su WSL (rete di sicurezza: `processors=12`, `memory=18GB`, scelta dell'utente) + B per il governo fine.
- Costo: somma dei due; la parte A resta con ok esplicito.

## Scenari pesati (dal brief)
| Scenario | Peso | A | B | C |
|---|---|---|---|---|
| Windows reattivo sotto carico | portante | medio (tetto duro ma solo grossolano) | medio-alto, solo se il carico viene dai comandi intercettati | alto |
| Test/build ancora usabili | alto | basso-medio (dipende dal tetto) | alto (coda, non rifiuto) | alto |
| Nessuna modifica silenziosa a config | alto | richiede ok | ok (nel repo) | ok per A con conferma |
| Costo fisso in token invariato | medio | invariato | invariato | invariato |

## Raccomandazione provvisoria
C, in due passi: prima B (nel repo, misurabile), poi A solo con numeri alla mano. Falsificatore: se la misura sotto carico (ignoto 1-2) mostra che il 100% viene da processi *non* intercettati (`claude -p`, MCP, `vmmem` per I/O), B non basta e A diventa la leva principale. Non ho contraddetto l'idea iniziale: nessuna era dichiarata.

Critica non eseguita con subagenti (tool `subagent` non disponibile): tradeoff fatto inline, un solo passaggio.
