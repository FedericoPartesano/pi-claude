# Esperimento 3: leve sul contesto, simulate sulle sessioni vere

Ipotesi: nascondere/accorciare ciò che il modello non serve più taglia molto dei token riletti.
Metodo: `PYTHONPATH=. python3 levers.py`. 16 sessioni, cache a prefisso (scadenza 1 h), il trascritto resta su disco;
cambia solo ciò che viene mandato al modello. Nascondere avviene a blocchi (per non rompere la cache a ogni passo) e ha una
penale: il 15% dei token nascosti ritorna come riletture.

| Leva | Risparmio |
|---|---|
| nascondere vecchi risultati dei tool (a blocchi) | 2,6% |
| togliere il vecchio pensiero | -1,2% |
| accorciare vecchi argomenti di edit/write | 0,2% |
| limitare ogni nuovo risultato a 2500 token | 6,1% |
| indice del progetto (ipotesi: ricerca/lettura -50%) | 11,3% |
| tutte insieme | 18,4% (da 1,7% a 44,6% per sessione) |

Conclusione: le leve sul contesto sono utili ma piccole. La causa è che la maggior parte del costo è lettura di cache a 0,1x
(già economica) e output (22%, non comprimibile). Un primo errore (-131%) era un bug nella penale che rompeva la cache: corretto.
