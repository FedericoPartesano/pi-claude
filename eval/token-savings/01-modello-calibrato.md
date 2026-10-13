# Esperimento 1: modello dei costi calibrato sulle sessioni vere

Script: `PYTHONPATH=. python3 model.py` (16 sessioni da ≥30 chiamate in `~/.pi/agent/sessions`).
Ricostruisce il contesto di ogni chiamata, simula la cache a prefisso e confronta con i token realmente fatturati
(lettura cache 0,1x, scrittura 1,25x, output 5x).

Risultato: totale reale 57,2M, modello con scadenza cache 5 min +6%, con 1 ora -9%. Il costo reale sta tra i due.
Il modello è abbastanza fedele per confrontare soluzioni (errore per sessione da -26% a +50%, sul totale <10%).
Limite: non vede quando la cache è scaduta per pause lunghe.
