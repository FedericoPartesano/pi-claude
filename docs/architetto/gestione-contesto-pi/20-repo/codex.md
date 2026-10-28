# openai/codex

## Source Register
| Campo | Valore |
|---|---|
| Repository | https://github.com/openai/codex |
| Commit | 970111f6cb62cc02fe36a82ea7d71b37a2889c97 (main, 2026-10-23) |
| Letto il | 2026-10-26 |
| Canale | `gh api` (3 file) |
| Licenza | Apache-2.0 — copiabile: sì |
| Dimensione | 697 MB |

## Salute
Push 2026-10-23; 131.000★; 24.870 issue/PR aperte; primo contributore 1.927 (di ~?). Scorecard non cercato.

## Architettura — fatti dal codice
- Compattazione in Rust (`codex-rs/core/src/compact*.rs`), anche **remota** ("remote v2"): il riassunto lo fa il backend. Non replicabile col nostro bridge. Evidenza: elenco file del commit.
- **Fallback di modello se la compattazione fallisce**: `should_retry_with_current_model` ritenta con il modello corrente se l'errore non è interruzione/budget e il modello è cambiato rispetto al turno precedente; ragioni tracciate (`context_limit`, `model_downshift`…). [compact_model_fallback.rs:9-30](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/core/src/compact_model_fallback.rs#L9)
- **Budget immagini nella compattazione**: stima per immagine da byte del riferimento, taglio della coda del messaggio tenendo l'immagine e la sua etichetta come unità atomica. [compact_remote_v2_images.rs:15-31](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/core/src/compact_remote_v2_images.rs#L15)
- Dato: il flag `cyber_access_program` entra nella decisione di fallback (stesso file, riga 22): il caso refusal "cyber" esiste anche qui. Fiducia media sul significato.

## Dolori
| Dolore | Evidenza | Che cosa insegna |
|---|---|---|
| Consumo di quota anomalo e conti incoerenti | https://github.com/openai/codex/issues/41220 | stessa famiglia del nostro obiettivo; il conto va misurato, non stimato |

## Comportamento eseguito
non eseguito: Rust, backend remoto.

## Cosa copiare
- Idea: ritentare il riassunto fallito con un altro modello (Apache-2.0). Per Pi: riassunto su un modello diverso dopo `refusal`.
## Cosa evitare
- Compattazione remota: dipende da un backend nostro non disponibile.
