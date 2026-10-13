# Esperimento 5: modello piccolo per i passi di sola esplorazione (limite massimo)

Metodo: `PYTHONPATH=. python3 routing.py`. Chiamate in cui il modello usa solo read/rg/grep/ls/cat/git/web: 1588 su 3450 (46%).
Prezzate a 1/3 (haiku vs sonnet).
Risultato: risparmio massimo teorico 29,6%. È un tetto: ignora che un modello piccolo può esplorare peggio (rischio qualità,
cioè file non trovati, ipotesi sbagliate) e che cambiare modello rompe la cache.
Prove di qualità non fatte: richiederebbero chiamate reali in massa (vietato dal vincolo).
