Aggiornato: 2026-10-23 · fase 1 (confermato)

# Regole e pattern del vault sempre presenti in Pi e nei sub-agenti

## Problema
Il vault contiene regole su come scrivere il codice e pattern. Oggi `extensions/vault.ts` indicizza per sezioni senza distinguerle e inietta una sola riga ("usa vault_search"). Il modello le conosce solo se decide di cercarle; i sub-agenti del team sono processi `pi` figli con `--tools read,bash,edit,write` (`pi-team/src/runner.ts:44`): non hanno `vault_search`, ricevono solo `role.instructions`.

## Risultato atteso (proposto)
Il codice scritto da Pi e dai sub-agenti rispetta le regole del vault senza che l'utente le ripeta; l'utente non deve correggere violazioni di regole già scritte nel vault.

## Modo di fallimento (proposto)
Un sub-agente viola una regola marcata presente nel vault, in un compito dove la regola era pertinente (misurabile con un eval a compiti noti, `eval/vault-regole/`). Si vede alla prima prova su un vault reale.

## Decisioni dell'utente
- Riconoscimento: **entrambe** — regole marcate dall'utente (frontmatter/cartella) = autorevoli; regole dedotte dal modello (passo opzionale, con stima token e conferma) = proposte da confermare.
- "Sempre chiari": **miglior rapporto qualità/costo in token, lo trova lo studio**. Vincolo di progetto: costo fisso minimo, prompt stabile per la cache.
- Profilo di spesa: **rapido** (2 ricerche, 3 repo, 1 critico).

## Vincoli duri
Stack del repo (TypeScript su Node ≥ 22.19); embedding locale; nessun costo token senza conferma; italiano per testi utente.

## Scenari di qualità (pesi proposti)
1. Aderenza (portante, 40): su N compiti con regola pertinente, ≥ 90% di esecuzioni conformi, anche nei sub-agenti.
2. Costo fisso (portante, 30): token aggiunti per richiesta ≤ ~400 e identici a parità di vault (cache).
3. Scalabilità (15): con 100 regole il costo fisso non cresce linearmente.
4. Manutenzione (15): l'utente modifica una nota e le regole attive si aggiornano senza altri passi.

## Candidate (dichiarate)
A. Digest compatto fisso iniettato in Pi e nei figli. B. Solo puntatore + guard che impone la lettura prima di edit/write. C. Selezione per compito: regole pertinenti recuperate per prompt (vault_search interno) e iniettate.

## Perimetro
Fuori: riscrivere l'indicizzatore; riassunti LLM obbligatori; regole fuori dal vault (CLAUDE.md già gestito da Claude Code).

## Tema di conoscenza
`regole-per-agenti-di-codice`
