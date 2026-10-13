# Esperimento 7: prova reale A/B dei livelli di contesto (Pi + provider claude-code, sonnet)

Codice: `extensions/context-tiers.ts` (+ test, 4 verdi; spegnibile con `PI_CONTEXT_TIERS=0`). Catena: `chain.mjs`
(8 passi su `marked`: 5 letture di file interi con `read`, poi 3 domande di richiamo sui fatti letti all'inizio).
A = Pi base, B = Pi + livelli (limite 12k token, tiene gli ultimi 2 turni). Costo = token equivalenti dai `usage` veri.

| Prova | Contesto | Affidabilità | Costo A | Costo B | Tempo A/B |
|---|---|---|---|---|---|
| 1 (cat, contesto piccolo ~6k car.) | mai sopra il limite | 8/8 e 8/8 | 23.179 | 22.780 / 19.852 | 26 s / 35 s, 28 s |
| 3 (read interi) | 92k car. -> 12k car. | 8/8 e 8/8 | 106.737 | 110.770 (+3,8%) | 31 s / 37 s (+19%) |

Letture:
- Affidabilità: invariata, anche sul richiamo di fatti letti all'inizio (il modello li ricorda dal riassunto o rilegge).
- Prova 1: il modello ha usato wc/grep invece di stampare i file, il contesto è rimasto piccolo: niente da risparmiare
  (stessa conclusione di lean/E4). Le differenze di costo sono rumore (cache).
- Prova 3: il contesto inviato scende del 87%, ma il costo NON scende (+3,8%) e il tempo sale. Causa: il provider
  claude-code riusa il processo Claude solo se la storia coincide; quando i livelli cambiano i vecchi messaggi, parte
  un nuovo processo che riparte dalla storia ridotta (scrittura di cache intera, 1,25x) e la catena è troppo corta per
  ammortizzarla. Coerente con la simulazione (blocchi utili solo su sessioni lunghe).
Conclusione: su catene corte nessun guadagno; la leva non si dimostra con questo test. Serve una catena da 40+ passi
(contesto >60k) per vedere il punto di pareggio: non ancora provato. Nessun 50% in vista da questa leva.
