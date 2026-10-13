# Esperimento 4: contesto fisso piccolo + parte adattiva recuperabile

Ipotesi (idea dell'utente): tenere il contesto basso come adesso, ma recuperare quando serve ciò che è rilevante.
Metodo: `PYTHONPATH=. python3 sweep.py`. Tutte le leve dell'esperimento 3, finestra sempre più stretta, e penale di
recupero (quota dei token nascosti che il modello richiede indietro) da 10% a 80%.

| Soglia / blocco / età | RE=10% | RE=30% | RE=50% | RE=80% |
|---|---|---|---|---|
| 60k/20k/12 | 18,4% | 16,1% | 13,9% | 10,5% |
| 30k/10k/8 | 21,8% | 19,0% | 16,1% | 11,8% |
| 10k/4k/3 | 25,9% | 22,7% | 19,4% | 14,6% |

Conclusione: anche con la finestra più stretta il risparmio massimo è ~26%, e ~15-23% con recuperi realistici. Stringere di più
non aiuta: ogni blocco nascosto rompe la cache e ogni recupero la ricostruisce. Il vantaggio vero del contesto adattivo è
la qualità su progetti grandi (reperire più di quello che entra), non il costo.
