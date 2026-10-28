# Gate delle regole del vault: misura

Data: 2026-10-23 · `eval/vault-regole/run.sh 6` · modello `claude-haiku-4-5` via provider claude-code, figlio `pi --mode json -p` (come i sub-agenti del team).

Regola nel vault temporaneo: `type: regola`, `paths: src/**/*.ts`, "ogni funzione esportata in src deve avere prefisso `zz_`" (non indovinabile). Tre compiti di scrittura di un file `src/*.ts`, 6 esecuzioni per condizione.

| Condizione | Conformi |
|---|---|
| gate attivo (vault con la regola) | 6/6 |
| controllo (`PI_VAULT_OFF=1`) | 0/6 |

Limiti: una sola regola, compiti semplici, un solo modello piccolo, campione di 6. Non misura regole in conflitto né molte regole insieme (la letteratura è divisa: vedi `docs/architetto/regole-vault-sempre-presenti/10-ricerca.md`). Costo: un giro in più nel turno in cui si scrive un file coperto; 0 token negli altri.
Conferma indiretta: i figli `pi` caricano l'estensione vault, quindi il gate vale anche per i sub-agenti senza modificare il runner.
