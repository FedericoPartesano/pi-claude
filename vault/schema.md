# Wiki Schema — pi-claude

Convenzione: [llm_wiki](https://github.com/nashsu/llm_wiki). Tre livelli: fonti grezze immutabili (`raw/`), wiki scritta e mantenuta dal modello (`wiki/`), regole (questo file e `purpose.md`). L'umano cura le fonti e fa le domande; il modello mantiene la wiki.

## Page Types

| Type | Directory | Purpose |
|---|---|---|
| entity | wiki/entities/ | Cose con un nome: pacchetti, estensioni, strumenti esterni |
| concept | wiki/concepts/ | Idee, tecniche, regole di progetto |
| source | wiki/sources/ | Riassunto di una fonte (documento del repo, articolo, report) |
| query | wiki/queries/ | Domande aperte in corso di indagine |
| comparison | wiki/comparisons/ | Confronti misurati fra alternative |
| synthesis | wiki/synthesis/ | Sintesi trasversali e conclusioni |
| overview | wiki/ | Riassunto del progetto (una sola pagina, `wiki/overview.md`) |

## Naming Conventions

- File: `kebab-case.md`
- Entità: nome ufficiale (es. `pi-claude-code.md`, `pi-ui.md`)
- Concetti: frase nominale descrittiva (es. `bridge-mcp-lockstep.md`)
- Fonti: `autore-anno-slug.md` (es. `partesano-2026-notes.md`)
- Query: la domanda come slug (es. `la-soglia-coseno-regge-su-un-vault-reale.md`)

## Frontmatter

Tutte le pagine hanno il frontmatter YAML:

```yaml
---
type: entity | concept | source | query | comparison | synthesis | overview
title: Titolo leggibile
tags: []
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Le pagine `source` hanno anche:

```yaml
authors: []
year: YYYY
url: ""        # URL o percorso nel repository
venue: ""
```

## Index Format

`wiki/index.md` elenca tutte le pagine raggruppate per tipo. Ogni voce:

```
- [[page-slug]] — descrizione di una riga
```

## Log Format

`wiki/log.md` è in sola aggiunta, dal più recente. Ogni voce inizia con un prefisso fisso, così `grep "^## \[" wiki/log.md | head -5` mostra le ultime cinque:

```
## [YYYY-MM-DD] ingest | Titolo della fonte
## [YYYY-MM-DD] query | Domanda
## [YYYY-MM-DD] lint | Esito
```

## Operations

- **Ingest**: leggere la fonte, discutere i punti chiave, scrivere la pagina in `wiki/sources/`, aggiornare entità e concetti toccati, `wiki/index.md`, `wiki/overview.md` se cambia il quadro, e aggiungere la voce in `wiki/log.md`.
- **Query**: leggere prima `wiki/index.md` (o usare `vault_search`), poi le pagine; rispondere citando le pagine. Le risposte utili tornano nella wiki come pagine `query`, `comparison` o `synthesis`.
- **Lint**: cercare contraddizioni, affermazioni superate, pagine orfane (senza link in entrata), concetti citati senza pagina, link mancanti; registrare l'esito in `wiki/log.md`.

## Cross-referencing Rules

- Link fra pagine con `[[page-slug]]`.
- Ogni entità e concetto compare in `wiki/index.md`.
- Le query linkano le fonti e i concetti da cui partono.
- Le sintesi citano tutte le fonti che le sostengono in `related:`.

## Contradiction Handling

Quando due fonti si contraddicono:
1. annotare la contraddizione nella pagina del concetto o dell'entità;
2. creare o aggiornare una pagina `query` che tiene aperta la domanda;
3. linkare entrambe le fonti dalla query;
4. chiudere in una pagina `synthesis` quando ci sono prove sufficienti (di solito una misura in `eval/`).

## Project-Specific Conventions

- Lingua delle pagine: italiano. Chiavi del frontmatter e valori di `type` in inglese, come da schema.
- Ogni affermazione su costo o qualità cita la misura (report in `eval/` o `bench/`).
