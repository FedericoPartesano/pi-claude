# Ignoto — risorse-sessioni-pi

| # | Domanda | Origine | Stato |
|---|---|---|---|
| 1 | Chi consuma di più nei picchi? | intervista | risolta in parte: con `node --test` su 137 file (35 s, 16 processi) load 12,4, PSI CPU 43%, RAM +2,2 GB; i test dominano il picco di CPU. Non misurato con più sessioni Pi insieme |
| 2 | Il 100% è CPU, RAM, o I/O disco / swap? | intervista | risolta per i test: CPU. PSI memoria ≤0,4, I/O ≤0,4, swap fermo a 3 MB, RAM libera ≥13 GB |
| 3 | Quante sessioni Pi contemporanee sono "tante"? | intervista | aperta |
| 4 | I test degli agenti partono da Pi (bash) o da `pi-team`? Dove si può mettere un semaforo? | intervista | aperta |
| 5 | `autoMemoryReclaim=gradual` e `sparseVhd` pesano sull'host? | intervista | aperta |
| 6 | Altri processi Windows (VPN Check Point, browser) che già occupano i ~10 GB lasciati? | intervista | aperta |
| 7 | `tool_call` di Pi può riscrivere `input.command` o solo bloccare? | ricerca | aperta |
| 8 | Un tetto `processors=` basta a tenere Windows reattivo? (WSL#9592: vmmem può bloccarsi comunque) | ricerca | aperta |
| 9 | Licenza e salute di turnstile; `shlock` non c'è su Linux: `flock` basta come semaforo? | repo | differita (si usa flock) |
