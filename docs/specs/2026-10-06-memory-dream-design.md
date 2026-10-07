# Memoria "umana" per Pi: `/dream` e `/ricorda` — design

Data: 2026-10-06 · Stato: approvato in chat · Origine: video "Karpathy ha appena risolto il più grande problema di
Claude" (`docs/research/2026-10-06-video-dreams-memory.md`) e Dreaming della Managed Agents API.

## Obiettivo e criteri di accettazione
Pi ricorda tra una sessione e l'altra ciò che conta (decisioni, preferenze, correzioni) e smette di ripetere gli errori
già corretti, **senza perdere la leggerezza**. Il lavoro è accettato solo se:
1. **Costo fisso zero senza memoria**: nessun file → token della prima richiesta identici a oggi (pi ~3,6k).
2. **Memoria in contesto con tetto**: ≤ 1.000 token (~3.600 caratteri) aggiunti per richiesta; prefisso stabile (cache).
3. **`/dream` economico**: una sola chiamata al modello (haiku) per esecuzione, input limitato (≤ ~30k token).
4. **Vantaggio misurato**: nella valutazione (sotto) le violazioni di correzioni già date calano in modo netto rispetto
   a "nessuna memoria", e i token totali per arrivare al risultato giusto non salgono. Se non c'è vantaggio → non si tiene.

## Modello (come la memoria umana)
| Umano | Pi |
|---|---|
| Breve termine | Sessioni salvate `~/.pi/agent/sessions/<cwd-codificata>/*.jsonl` (già esistono) |
| Sonno/consolidamento | `/dream` |
| Lungo termine semantico | `.pi/memory.md` (progetto) e `~/.pi/agent/memory.md` (globale, preferenze personali); caricati in contesto |
| Episodica | `.pi/memory-archive.md` (e globale): perché delle decisioni, episodi, ricordi sbiaditi o superati; **non** in contesto |
| Rinforzo | contatore di conferme per ricordo |
| Salienza | le correzioni dell'utente ("no, te l'avevo detto…", "non farlo più") pesano di più |
| Oblio | ricordo mai riconfermato da > 60 giorni → proposto per l'archivio; 📌 = mai |
| Riconsolidamento | contraddizione → vince il più recente, il vecchio va in archivio con data |
| Capacità limitata | tetto di caratteri sulla memoria in contesto: il consolidamento deve scegliere |

## Formato di `memory.md`
```markdown
# Memoria di Pi
<!-- gestita da /dream: modificabile a mano -->
- [correzione] Prezzi sempre in centesimi interi, mai float. (conferme: 3 · ultima: 2026-10-06)
- [preferenza] Niente commit senza richiesta esplicita. 📌 (conferme: 5 · ultima: 2026-10-05)
- [decisione] Intent in intents/, non intent/. (conferme: 1 · ultima: 2026-10-06)
- [fatto] Il test di totalValue in inventory.test.js è rotto da prima. (conferme: 2 · ultima: 2026-10-04)
```
Una riga per ricordo: tipo, testo, 📌 opzionale, metadati tra parentesi. L'archivio ha lo stesso formato più un motivo
(`superato da …`, `sbiadito`, `episodio`).

## Componenti
- `extensions/memory.ts` (estensione) + funzioni pure testate:
  - `parseMemory` / `renderMemory`; `applyProposal(memory, archive, proposal, today)` → nuovi file (deterministico);
  - `lookback(sessionFiles, sinceTimestamp)` → testo ridotto: solo messaggi utente e risposte finali dell'assistente,
    niente output dei tool, **segreti mascherati** (chiavi tipo `sk-…`, `ghp_…`, `AKIA…`, `password=…`, token lunghi);
    limite di caratteri, prima le sessioni più recenti;
  - `bm25Search(archiveEntries, query)` per `/ricorda`, senza dipendenze (interfaccia sostituibile con embedding);
  - `fitBudget(entries, maxChars)` per il tetto (prima 📌, poi correzioni, poi per conferme e recenza).
- Caricamento: a `before_agent_start`, se esistono i file, la memoria (globale + progetto, entro il tetto) viene
  aggiunta al system prompt; nessun file → nessuna modifica.
- `/dream [--global]`: lookback delle sessioni del progetto non ancora consolidate (stato in `.pi/memory-state.json`:
  ultimo timestamp consolidato) → **una** chiamata al modello (haiku, via `ctx.modelRegistry.streamSimple` o un
  processo `pi -p` figlio con `< /dev/null`) con memoria attuale + sessioni ridotte → proposta JSON
  `{add, reinforce, merge, update, forget}` → riepilogo per l'utente (picker/select o testo) → approvazione (tutto o
  per voce) → `applyProposal`. Senza UI: scrive la proposta in `.pi/dream-proposal.md` e non applica nulla.
- `/ricorda <query>`: BM25 sull'archivio, mostra i risultati e li inserisce nel contesto della conversazione solo se
  l'utente conferma (o con `/ricorda --use`).
- Promemoria gratuito: a `session_start` conta le sessioni del progetto più recenti dell'ultimo consolidamento
  (solo `stat`); se ≥ 5 → notifica "N sessioni da consolidare → /dream".
- Installazione come intent/goal/loop (percorso reale in `settings.json`).

## Valutazione (`eval/memory-*.mjs`)
- Fixture + **sessioni sintetiche** in formato Pi in cui l'utente corregge Pi su 6 regole non deducibili dal codice
  (es. centesimi interi, nomi in inglese nel codice, niente nuove dipendenze, test in `test/<modulo>.test.js`,
  messaggi d'errore in italiano, mai toccare `src/csv.js`), più rumore (sessioni irrilevanti, una regola poi
  contraddetta e aggiornata, un segreto finto da non copiare).
- Bracci: **nessuna memoria** · **memoria dopo `/dream`** (consolidamento reale con haiku sulle sessioni sintetiche) ·
  (controllo) **sessioni intere in contesto** (il "tutto in memoria" del video, per mostrare il costo).
- Compiti: 6–8 richieste nuove che invitano a violare le regole. Controlli deterministici per regola.
- Metriche: regole rispettate, token per richiesta (overhead della memoria), costo di `/dream`, segreto mai copiato,
  regola contraddetta risolta verso la versione recente, dimensione di `memory.md`.
