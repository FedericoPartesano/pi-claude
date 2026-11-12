---
stato: bozza
---
# Schema dati — pi-claude

Nessun database: strutture su file, in locale per un solo utente. «Chi» = processo.

| Struttura | Dove | Campi principali | Scrive / legge |
|---|---|---|---|
| Stato di `/auto` (`AutoState`) | JSON fuori dalla worktree | slug, fase, requisiti, hash dei check, `StopReason`, budget/tempo/passi | scrive il supervisore; legge cockpit; il figlio non lo tocca |
| Requisito (`Requirement`) | `auto/requisiti.json` in worktree | id, descrizione, check (shell), prova | scrive il figlio (input non fidato, validato a schema); i check si congelano a fine plan; li esegue il supervisore |
| Diario (`DiaryEvent`) | `<repo>-auto/<slug>.eventi.jsonl` | evento tipizzato, tempo, passo, esito, durata, token | scrive il supervisore (append); legge cockpit (riga troncata tollerata) |
| Decisioni / da approvare | `auto/decisioni.md`, `auto/da-approvare.md` | righe `- scelta — motivo/alternativa` | scrive il figlio; legge l'utente |
| Intent | `intents/<data>-<slug>.md` | status (draft…rejected), problema, outcome, vincoli, verifica | scrive Pi/utente |
| Vault | `vault/raw` (sola lettura), `vault/wiki`, `vault/progetto` | frontmatter tipizzato | modello mantiene wiki; umano cura raw; progetto di sola lettura durante build |
| Memoria | indice locale di pi-memory | voci, embedding e5 | pi-memory |
| Sessioni | gestite da Pi | messaggi, nome | Pi |

Relazioni: un'esecuzione ↔ uno slug ↔ una worktree/branch `auto/<slug>`; un requisito ↔ un check; un passo ↔ molti eventi del diario.
Accesso: tutto è dell'utente locale; nessun permesso a ruoli. Confine fidato/non fidato: ciò che scrive il figlio non viene eseguito se non come check congelato.
