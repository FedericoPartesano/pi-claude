# Confronto repo e strumenti — risorse-sessioni-pi

Modalità `completa` ridotta a 3 riferimenti (repo-scouting non eseguito per intero: nessun tool subagente, ricerca web limitata a DuckDuckGo/Exa gratuito).

| Riferimento | Cosa fa | Licenza | Salute | Dolori noti |
|---|---|---|---|---|
| wingedsheep/argentum-engine `scripts/gradle-locked` | semaforo a 2 slot tra worktree, coda, timeout, lock a prova di crash | NOASSERTION | push 2026-10-22, 74 stelle | dipende da `shlock` (macOS); senza `shlock` gira senza lock |
| GNU parallel `sem` / `flock` / `nice` | semaforo a conteggio, mutex, priorità | GPL / util-linux | standard | va incapsulato a mano; nessuna memoria |
| turnstile (marginalutility) | intercetta a livello PATH, ammette per memoria libera e picco appreso, pausa/uccide i fuori controllo | non verificata | non verificata | prodotto di parte; macOS (`kern.memorystatus_level`) |
| systemd-run --user --scope | cgroup v2: `MemoryMax`, `CPUQuota`, `TasksMax` per comando o sessione | LGPL (systemd) | disponibile qui | richiede systemd attivo (qui sì); un OOM nel cgroup uccide solo quel gruppo |

Verifica `file:riga` con `gh api` fatta solo su argentum (esistenza, licenza, data). Non verificati turnstile e SPDX di sem.
