# OpenHands/software-agent-sdk

## Source Register
| Campo | Valore |
|---|---|
| Repository | https://github.com/OpenHands/software-agent-sdk |
| Commit | ab0fbb4b5a456f3df0a03df1bc50dd850725d8bd (main, 2026-10-26) |
| Letto il | 2026-10-26 |
| Canale | `gh api` (1 file, 566 righe) |
| Licenza | MIT — copiabile: sì |

## Salute
Push 2026-10-26; 1.305★ (l'SDK; l'app OpenHands ne ha 91.894); 734 issue aperte; primo contributore 434 su ~1,1k.

## Architettura — fatti dal codice
- `LLMSummarizingCondenser` (`condenser/llm_summarizing_condenser.py`): scatta per **numero di eventi** (`max_size` 240) o per richiesta o per pressione di token; `keep_first` 2 eventi mai condensati; tiene una coda di `max_size//2`. [righe 64-95, 140-180](https://github.com/OpenHands/software-agent-sdk/blob/ab0fbb4b5a456f3df0a03df1bc50dd850725d8bd/openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py#L64)
- **Rapporto minimo** da condensare (riga ~77): condensazioni sotto una soglia di quota sono saltate. Scopo: evitare condensazioni che rendono poco.
- `hard_context_reset` (righe 359-400): se il riassunto fallisce perché la vista è troppo grande, ritenta fino a 5 volte **riducendo la lunghezza massima per evento del 20% a ogni giro** e poi alza errore. È un tetto ai tentativi con scala, non un ciclo infinito.
- Pipeline di condenser (`pipeline_condenser.py`): più condenser in sequenza.

## Dolori
non letti. `unknown`.

## Comportamento eseguito
non eseguito.

## Cosa copiare
- Rapporto minimo da condensare + tetto di 5 tentativi con riduzione progressiva (MIT): risolve il ciclo di Pi (tentativi illimitati a ogni giro).
