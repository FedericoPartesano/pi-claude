# Ricerca — risorse-sessioni-pi

## R1. Che cosa limita WSL2 e che cosa no
- Default di `processors`: stesso numero di processori logici di Windows; default di `memory`: 50% della RAM di Windows. Qui `.wslconfig` fissa `memory=20GB` (65% di 30,8 GB) e lascia `processors` al default (16). — https://learn.microsoft.com/en-us/windows/wsl/wsl-config (recuperata)
- `autoMemoryReclaim`: `disabled | gradual | dropCache`; `gradual` rilascia la cache lentamente. Non limita l'uso, restituisce solo cache. — stessa pagina (recuperata)
- Un tetto di CPU a livello WSL è un solo numero per tutte le sessioni insieme: non distingue test da altro. `wsl --shutdown` per applicarlo.
- Contro-evidenza / rischio: issue aperta microsoft/WSL#9592 "WSL stops responding and vmmem spikes CPU to 100%" (2023→2025, ancora aperta) → un tetto non esclude blocchi da `vmmem`. — https://github.com/microsoft/WSL/issues/9592 (solo estratto di ricerca, non recuperata)

## R2. Come si governano carichi pesanti concorrenti su Linux
- Strumenti da shell: `sem -j N` (semaforo a conteggio, GNU parallel), `flock` (mutua esclusione), `niceload`, `nice`, `make/ninja -l`. Limiti dichiarati: qualcuno deve incapsulare il comando; il load average non è memoria; il numero di slot è una stima; un solo semaforo per tutti i tipi di carico; niente dopo l'avvio. — https://turnstile.marginalutility.dev/alternatives/shell-tools (recuperata; fonte di parte: vende turnstile)
- Caso gemello: `argentum-engine/scripts/gradle-locked` (74 stelle, licenza NOASSERTION): N agenti in worktree diversi, 3 build insieme saturano 8 core/32 GB e i test sforano i timeout; soluzione = semaforo globale a 2 slot su percorso fisso, coda con messaggio, timeout 30 min, lock liberato anche se il processo muore. — https://github.com/wingedsheep/argentum-engine/blob/3dec8932/scripts/gradle-locked (recuperata)
- Cgroup v2 senza root: qui `systemd=true`, cgroup2, e per l'utente sono delegati `cpu memory pids`. `systemd-run --user --scope -p MemoryMax=100M -p CPUQuota=50%` ha prodotto `cpu.max = 50000 100000` e `memory.max = 104857600` (misura locale, 2026-10-22). `CPUQuota=100%` = un solo core. — man systemd.resource-control, https://www.freedesktop.org/software/systemd/man/systemd.resource-control.html (solo estratto)
- `node --test`: per default un processo figlio per file, fino a `os.availableParallelism()` (qui 16); `--test-concurrency=N` lo abbassa. — https://nodejs.org/api/test.html (solo estratto)

## R3. Sessioni di agenti, processi e MCP
- Claude Code: ogni subagente è un processo `claude` che avvia da sé i suoi MCP → N sessioni × M server; processi MCP orfani restano vivi dopo la fine del compito. — https://github.com/anthropics/claude-code/issues/48649 e #39675 (solo estratti)
- Misura locale (una sola sessione Pi): 3× `claude -p` ~0,25 GB, embedder 0,6 GB, 3 processi `chrome-devtools-mcp`, `nb` 0,09 GB, daemon micelio-brain 0,7 GB fuori da Pi. `docs/perf.md` già misura -36% RAM / -51% CPU con embedder in figlio e reaper.
- Nel repo: `pi-team` ha `MAX_PARALLEL=8`, "aggressivo per scelta (velocità prima)", regolato solo dall'uso dell'abbonamento, non dal carico della macchina (`pi-team/src/budget.ts`, `PI_PARALLEL_MAX`). Nessun semaforo per test/build. `extensions/guards.ts` usa `pi.on("tool_call")` e può bloccare una chiamata.

## Gate
- Affermazioni portanti: 8, con URL recuperato davvero: 3 (docs WSL, gradle-locked, turnstile) + 2 misure locali; solo estratto: 3 (WSL#9592, claude-code#48649, doc Node)
- Contro-evidenza cercata per: tetto WSL (WSL#9592), semaforo (limiti dichiarati da turnstile) · non trovata per: efficacia di `CPUQuota` sul fluidità di Windows
- Famiglie di fonti: 6 (Microsoft, GitHub issue WSL, turnstile, argentum, freedesktop, Anthropic/GitHub)
- unknown dichiarati: se un tetto `processors=` basta a tenere Windows reattivo; se `tool_call` può riscrivere il comando bash (non solo bloccare); causa reale del 100% (CPU, RAM o I/O); quante sessioni sono "tante"
