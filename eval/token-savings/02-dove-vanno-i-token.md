# Esperimento 2: dove vanno i token

Script: `PYTHONPATH=. python3 decompose.py` (costo attribuito a ogni elemento del contesto, per tipo).

| Quota | Voce |
|---|---|
| 32,4% | risposte del modello rilette a ogni chiamata (di cui: argomenti dei tool 23%, pensiero 7%, testo 6% del costo totale) |
| 22,0% | output scritto dal modello |
| 16,6% | bash di ricerca/lettura (rg, grep, ls, cat, git) |
| 10,6% | system prompt + definizioni tool |
| 6,0% | tool read |
| 3,2% | riassunti di compattazione |
| 3,2% | bash altro |
| 2,1% | test/build |

Conclusioni:
- Esplorare il progetto (ricerca + lettura file) costa il 22,6% del totale: è il bersaglio di un indice del progetto.
- Gli argomenti dei tool (edit, write, comandi lunghi) pesano più dei risultati: il 23%. Scrivere meno testo nei comandi aiuta.
- Pulire i vecchi risultati dei tool tocca solo il ~23% e simulato dà ~19-22%.
