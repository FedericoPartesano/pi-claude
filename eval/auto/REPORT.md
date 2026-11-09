# Auto mode: misure

## 2026-11-09 · costo di un passo (fase 4 dello studio `docs/architetto/auto-mode/`)
Modello haiku, provider `claude-code`, WSL. Turno «rispondi solo: ok», `pi --mode json -p --no-session`.

| Configurazione | Token di prefisso per turno | Tempo totale |
|---|---|---|
| Sessione completa dell'utente (tutte le estensioni, skill, CLAUDE.md) | 23 906 (2 902 cacheWrite + 21 004 cacheRead al primo giro; 23 906 cacheRead al secondo) | 8,6 s; 6,8 s |
| Figlio `--no-extensions -e pi-claude-code --no-skills --tools read,bash,edit,write` | 4 554 (cacheWrite al primo giro, cacheRead dopo) | 4,4 s; 4,4 s; 6,6 s |
| Figlio + estensione con un comando e due hook | 4 554 | — |

Lettura: il prefisso del figlio è il 19% di quello della sessione completa; comandi e hook non costano token. I tempi includono l'avvio di Pi e di `claude -p`.

Limiti:
- solo 2–3 giri per configurazione, su una macchina sola;
- il turno è minimo, quindi il costo di un passo vero (letture, edit, test) non è misurato;
- il costo di un goal intero si misura sul banco.
