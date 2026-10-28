# Brief — risorse-sessioni-pi

Stato: bozza, da confermare.

## Problema
Con più sessioni Pi aperte, soprattutto quando gli agenti lanciano test/build o sub-agenti, RAM e CPU di WSL arrivano al 100% e tutto Windows rallenta.

## Risultato atteso
Con N sessioni Pi e carichi pesanti, Windows resta fluido: WSL non supera un tetto fisso di RAM e CPU, e i carichi pesanti (test, build, sub-agenti) sono serializzati o limitati. Misurato prima/dopo con `scripts/perf-baseline.mjs` e un carico sintetico di test paralleli.

## Modo di fallimento
Limiti così stretti che le sessioni muoiono (OOM) o i test diventano troppo lenti da usare; oppure rimedi che toccano config senza ok.

## Fatti (misurati 2026-10-22)
- Host: Ryzen 7 PRO 5875U, 8 core/16 thread, 30,8 GB RAM.
- WSL2: `memory=20GB`, `swap=8GB`, nessun `processors=` → 16 thread, 20 GB a WSL, ~10,8 GB a Windows.
- Già fatto (docs/perf.md): embedder in processo figlio, reaper dei `claude -p` inattivi: RAM -36%, CPU primi 25 s -51%.
- Ora con una sessione: pi 1,1 GB, embed-child 0,6 GB, 3× `claude -p` ~0,25 GB ciascuno, MCP (chrome-devtools ×3 processi, nb, ecc.), più micelio-brain daemon 0,7 GB e `claude --resume` 0,5 GB fuori da Pi.
- Esistono budget/orchestratore in `pi-team/src/` (tetti di sub-agenti); nessun semaforo per test/build.

## Scenari di qualità
- Windows reattivo sotto carico — `portante`
- Test e build degli agenti ancora utilizzabili (< 2× più lenti) — alto
- Nessuna modifica silenziosa a config utente — alto
- Costo fisso in token invariato — medio

## Profilo / tema
default (3 ricerche, 4 repo, 2 critici). Tema: `risorse-processi-agenti`.

## Candidata nel brief
Nessuna dichiarata. Ipotesi da valutare: (A) tetto a livello WSL (`.wslconfig`: `processors`, `memory`); (B) governo nel repo (semaforo globale per test/build, `nice`/cgroup, tetto sessioni `claude -p`); (C) A+B.
