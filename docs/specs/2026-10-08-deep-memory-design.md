# Memoria profonda: ricordare tutto quando serve, a costo costante

Data: 2026-10-08 · Stato: approvata in chat ("mi piacciono tutte, scrivi la spec e procedi")

## Perché

La memoria attuale (`/dream` + richiamo ibrido, max 5 ricordi, ~60 token) è leggera ma **superficiale**: oltre i 5
ricordi più vicini alla domanda non sa niente, non collega i ricordi tra loro, salva rumore (episodi come "l'utente ha
scritto asd, Pi ha chiesto chiarimenti", anche due volte) e non dimentica mai. L'utente vuole una memoria "come una
persona": profonda, che capisce da sola cosa salvare e dove, che dimentica quello che non serve più, e la cui
crescita **non** fa crescere i token per richiesta né rallenta Pi.

## Principio

Una persona non tiene in testa tutto: ha un **quadro** sempre presente, **spunti** che affiorano quando qualcosa li
richiama, e va **a fondo** solo quando serve. Il costo fisso per richiesta resta costante con 50 o 50.000 ricordi;
la crescita aumenta la qualità, non il costo.

| Livello | Cosa | Quando | Costo |
|---|---|---|---|
| Quadro | riassunto del progetto ≤ 300 token | sempre, nel prompt di sistema (stabile → cache) | ~30 token effettivi (cache) |
| Spunti | fino a 12 righe (i 2 più forti interi, gli altri ≤ 70 caratteri) | per richiesta, solo se pertinenti; 0 se non c'è niente | 0–300 token (stesso tetto di oggi) |
| Contesto | ricordi legati a file/entità toccati | sul risultato di read/edit, max 3 righe, una volta per sessione e file | 0–60 token |
| Fondo | tool `ricorda`: ricordo completo, collegati, episodio | solo quando il modello lo chiama | a consumo |

## Cosa si costruisce

### 1. Grafo dei ricordi (stile Obsidian)

- Ogni ricordo ha `links: string[]` (id di altri ricordi) oltre a `entities` (file, identificatori, requisiti come
  `RF-07`, concetti). Le entità sono nodi: due ricordi con un'entità in comune sono collegati.
- `/dream` crea i link (`"links"` nel JSON di consolidamento) quando un ricordo spiega, dipende da o contraddice un
  altro; i link verso ricordi dimenticati si tolgono.
- Indice `graph.json` (entità → ids, id → vicini) ricostruito da `/dream` e al caricamento se manca/vecchio:
  vicini in O(grado), niente scansioni.
- **Attivazione per diffusione**: i ricordi colpiti dalla domanda passano metà del punteggio ai vicini (1 salto);
  un vicino entra negli spunti solo se supera la soglia.
- `/memory export` scrive una cartella `.md` compatibile con Obsidian (un file per ricordo, `[[link]]`, frontmatter
  con tipo/forza/livello) per vedere il grafo; sola lettura, non è la fonte di verità.

### 2. Quadro del progetto

- `/dream` (anche automatico) riscrive `.pi/memory/gist.md`: com'è fatto il progetto, regole e decisioni chiave, cosa è
  in corso. Massimo 1200 caratteri (≈ 300 token), tagliato se il modello sfora.
- Sostituisce il "core" attuale nel prompt di sistema; cambia solo a ogni `/dream` (cache stabile). I ricordi fissati
  (`pinned`) restano garantiti: il quadro li include.
- Livello personale: `~/.pi/agent/memory/gist.md` (≤ 400 caratteri) con le preferenze che valgono ovunque.

### 3. Spunti invece di ricordi interi

- Il richiamo restituisce fino a 12 ricordi: i 2 più forti interi (≤ 180 caratteri), gli altri come **spunto**: `gist`
  del ricordo (≤ 70 caratteri, scritto da `/dream`; se manca, il testo tagliato), ognuno con `#id` per andare a fondo
  con `ricorda`.
- Budget adattivo: saluto/chiacchiera → 0; domanda di sola lettura → fino a 6; altro → 8; compito → fino a 12. Tetto fisso 1080 caratteri (≈ 300 token, lo stesso
  di oggi) più l'intestazione: a parità di tetto, più del doppio dei ricordi.
- Intestazione esplicita: sono contesto, non una richiesta (fatto: il modello rispondeva ai ricordi).

### 4. Tool `ricorda`

- `ricorda({ id })` → ricordo completo, link e vicini (spunti); `ricorda({ query })` → ricerca profonda (anche
  dormienti e superati, segnalati); `ricorda({ episodio: query })` → cerca nelle sessioni passate del progetto e
  restituisce solo il pezzo pertinente (max 1500 caratteri), con data e sessione.
- Descrizione ≤ 60 token (costo fisso misurato; regola "leggerezza prima di tutto"). Spegnibile con
  `PI_MEMORY_TOOL=0`.
- Ogni uso rinforza il ricordo (conta come utile).

### 5. Richiamo dal contesto

- Su `tool_result` di `read`/`edit`/`write`, se il percorso è un'entità di ricordi forti, si aggiunge in coda al
  risultato `[memoria] spunto #id` (max 3 righe). Una volta per sessione e file; azzerato dopo la compattazione.
- Costo zero se nessun ricordo cita quel file (lookup nell'indice entità, < 1 ms).

### 6. Cosa salvare (salienza) e dove (livello)

- `/dream` riceve criteri espliciti: si salva solo ciò che **cambierà una decisione futura** (correzioni, preferenze,
  decisioni con il perché, fatti non deducibili dal codice, episodi con una lezione). Non si salva: chiacchiere,
  messaggi senza contenuto, tentativi falliti senza lezione, cose che il codice o git già dicono.
- Filtro deterministico dopo il modello: scarta episodi senza entità né lezione e i doppioni quasi identici
  (similarità ≥ 0.92 con un ricordo esistente → rinforzo invece di aggiunta).
- Livello deciso da `/dream` per ogni ricordo: `progetto` (default), `personale` (vale ovunque: lingua, stile,
  strumenti → `~/.pi/agent/memory`). Un ricordo di progetto confermato in ≥ 2 progetti diventa personale.

### 7. Dimenticare con intelligenza

- **Utilità** di un ricordo = rinforzi + richiami usati (citato dal modello o aperto con `ricorda`) − richiami ignorati;
  la **forza** decade col tempo dall'ultimo uso (curva esistente).
- Stati: `attivo` → `dormiente` (forza bassa e non usato da 90 giorni: fuori dagli spunti, trovabile con `ricorda`)
  → `dimenticato` (dormiente da altri 90 giorni e mai usato: tolto dal file, scritto in `forgotten.jsonl`,
  recuperabile per 30 giorni con `/memory restore`).
- Mai dimenticati in automatico: `pinned`, correzioni confermate ≥ 2 volte.
- Obsolescenza: ricordi le cui entità-file non esistono più nel progetto → dormienti subito (il codice è cambiato).
- `/dream` può proporre `forget` con un motivo (già supportato) e ora anche `dormant`.
- Il riepilogo di `/dream` dice cosa ha dimenticato/addormentato (una riga).

### 8. Scala e velocità

- Vettori in `vectors.bin` (Float32 contigui + `vectors.idx.json` id→offset), letti con un solo `readFileSync`;
  migrazione automatica da `vectors.json`.
- Indice di richiamo (BM25, entità, grafo) costruito una volta e invalidato per mtime dello store.
- Obiettivi: richiamo < 5 ms a 10.000 ricordi (senza embedding della domanda), avvio di Pi invariato (± 50 ms),
  memoria RAM < 40 MB a 10.000 ricordi.

## Vincoli

- Costo fisso per richiesta, misurato con 50 / 1.000 / 10.000 ricordi sintetici: quadro ≤ 300 token + spunti ≤ 300 +
  descrizione tool ≤ 60. Nessuna crescita con il numero di ricordi.
- Senza store: zero token, zero lavoro (come oggi).
- Compatibilità: i record esistenti si leggono senza migrazione manuale (`links`, `gist`, `state`, `level`
  opzionali).
- Ogni pezzo spegnibile: `PI_MEMORY_TOOL=0`, `PI_MEMORY_CONTEXT=0`, `PI_MEMORY_FORGET=0`.

## Bug collegati

- Il riepilogo "Memoria aggiornata …" e lo stesso episodio compaiono due volte: da capire e correggere (doppio
  `/dream` automatico o doppio rendering).

## Verifica

- Test unitari per ogni pezzo (grafo, spunti, budget adattivo, salienza, oblio, contesto, tool, vettori binari).
- Esempio negativo obbligatorio: l'episodio "messaggi casuali asd… clear" non viene salvato.
- Scala: `scale.test.ts` esteso a 10.000 ricordi (tempo, token, RAM, nessun falso positivo).
- Profondità: scenario con 300 ricordi in cui la risposta giusta richiede un ricordo collegato (1 salto) o un episodio:
  recall@spunti e uso di `ricorda` misurati; costo per richiesta confrontato con la memoria attuale.
