# Pi «va in sleep»: analisi delle sessioni reali (6 novembre)

Fonte: `~/.pi/agent/sessions` (escluse eval e `/tmp`), 12 ottobre – 6 novembre. Durata di un `bash` = timestamp del messaggio assistente con la chiamata → timestamp del `toolResult`. Script: `durate-bash.py`, `latenza-e-quota-sleep.py`, `sleep-per-modello.py` (eseguire con `python3 -I`, dalla cartella delle sessioni).

| Misura | 12 ott – 3 nov | 4 – 6 nov |
|---|---|---|
| Comandi `bash` con `sleep N` | 8% (ISAB 8–9%, pi-claude 8%) | 18–27% (ISAB 25%, 18%, pi-claude 25%) |
| Durata dello sleep, mediana / p90 | 9 s / 150 s | 120 s / 290 s |
| Comandi >30 s | ≈10% | 18% → 22% → 30% |
| Timeout scattati al giorno | 0–12 | 2–7 |
| Comandi rapidi (`ls`, `cat`, `git status`…) mediana | 0,04–0,10 s | 0,04–0,12 s |
| Latenza del modello dopo un tool result, mediana | 2,9–4,5 s | 3,0–4,0 s |
| Modello | sempre `sonnet` | sempre `sonnet` |

Lettura: nessun rallentamento di Pi, dei comandi o del modello. È cambiato l'uso: da 4 novembre il modello lancia job lunghi (suite e2e, banchi) e li sorveglia con `sleep 280–295; tail …`, cioè al limite del timeout di bash (295 s). Il fenomeno è uguale in tutti i progetti, quindi non dipende da una singola estensione. Il prompt di sistema non nomina sleep prima del 6 novembre (riga sul tool `lancia`).
Limiti: correlazione, non causa; le sessioni di lavoro sul repo includono i miei banchi; durate dai timestamp (includono code); la causa del cambio di abitudine non è isolata. Il banco `eval/jobs/REPORT.md` mostra che con `lancia` 9/9 risposte giuste e 0 sleep (senza: sleep in 8 run su 9).
