# Benchmark Claude Code nativo vs Pi (bridge claude-code) — 2026-09-24

Comando: `node bench.mjs <runs> <scenario>` (cwd /tmp/pitest, modello Sonnet in entrambi, abbonamento).
Claude Code nativo = setup reale dell'utente (plugin, hook, skill, connettori MCP, CLAUDE.md).
Pi = `pi` (4 tool) per simple/code, `pi-full` (subagent) per delegate.

| Scenario | Harness | Tempo medio | Input token (tot. run) | Output token | Correttezza |
|---|---|---|---|---|---|
| simple (leggi 1 file), 3 run | Claude Code | 16.8 s | ~65.9k | ~26 | 3/3 |
| | Pi | 11.0 s | 10.2k | 76 | 3/3 |
| code (trova riga in un progetto), 3 run | Claude Code | 9.8 s | ~67.8k | ~39 | 3/3 (con `--add-dir`; senza: 0/3, accesso bloccato) |
| | Pi | 6.2 s | 10.5k | ~155 | 3/3 |
| delegate (stesso compito via sub-agente), 2 run | Claude Code | 21.7 s | ~94.1k (solo agente principale*) | ~43 | 2/2, con rumore ("connettori Gmail…") |
| | Pi | 15.7 s | 37.1k + 12.2k sub-agente = 49.3k | ~350 + ~380 sub | 2/2 |

\* lo stream di Claude Code non espone l'usage del sub-agente: il suo totale reale è più alto.

Note:
- quasi tutto l'input è cache read in entrambi (pesa meno sui limiti, ma pesa).
- per richiesta: Claude Code ~33k token di contesto, Pi ~5k (`pi`) / ~12k (`pi-full`).
- Pi: token identici run dopo run (contesto deterministico); Claude Code varia (64.8k–67.3k).
- Pi produce più output token (risposte più verbose): pochi in assoluto.

## Dopo le ottimizzazioni (round 3)
- 12 skill di `~/.agents/skills` escluse solo in Pi (tenute: tdd, diagnosing-bugs, code-review,
  resolving-merge-conflicts): contesto base per richiesta **5.057 → 3.374 token** (−33%).
- scenario code, 2 run Pi: 5.1 s / 6.0 s, **7.2k** input token (era 10.5k; Claude Code 67.8k → −89%).
- TUI con pre-avvio: prima risposta ~1.1 s dopo l'invio (prima 5–12 s di avvio a freddo).
