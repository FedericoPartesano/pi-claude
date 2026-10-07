# Video: "Claude Code ora parte da INTENT.md" — note

- **Fonte:** https://youtu.be/6vE_8-X2DPA
- **Titolo:** Basta codice da rifare: Claude Code ora parte da INTENT.md (Tutorial)
- **Canale:** Giovanni Beggiato · durata 15:34 · lingua italiano
- **Ricavato da:** sottotitoli automatici YouTube (2026-10-06). Note riassuntive per sezione, non trascrizione
  integrale. I sottotitoli automatici storpiano alcuni nomi ("Cloud" = Claude, "Gitab" = GitLab/GitHub,
  "Playrg" = Playwright); qui sono corretti.
- **Attenzione:** il video riassume a voce un documento Anthropic ("AI Native SDLC Playbook"), che qui non è
  verificato sull'originale.

## 00:00 — Contesto

- Il creatore di Claude Code ha pubblicato l'**AI Native SDLC Playbook**: come Anthropic sviluppa software
  al suo interno.
- SDLC (Software Development Life Cycle): il percorso da idea → progetto → realizzazione → messa in produzione.
- Prima degli agenti il collo di bottiglia era la **costruzione** (scrivere codice a mano). Oggi la costruisce
  Claude Code, quindi quella fase si accorcia drasticamente: la differenza è il "tempo di ciclo recuperato".
- Domanda del playbook: come velocizzare le **altre** fasi, che restano lente perché richiedono ancora molto
  input umano.

## 01:57 — Ciclo tradizionale

Catena di team in sequenza:

1. **Product** — raccolta requisiti ("abbiamo questo problema, serve questa soluzione").
2. **Design / architetti** — traducono i requisiti in specifiche tecniche.
3. **Software engineering** — traduce le specifiche in codice.
4. **QA** — prova il codice.
5. **Operations** — mette in produzione e manutiene.

Con gli agenti, solo la fase 3 è "risolta"; il video passa a come Anthropic snellisce il resto. Nel diagramma
del playbook ogni blocco è marcato come *umano + AI* oppure *completamente delegato all'AI*.

## 04:04 — Fase 1: `intent.md`

- Tutto parte da un file **`intent.md`**, che può scrivere **chiunque**, anche non tecnico (prima era compito
  del product manager).
- Si crea facendo **brainstorming con Claude** (claude.ai, Cowork, o skill dedicate tipo brainstorming di
  superpowers / `grill`). Non serve saper usare Claude Code.
- Template proposto da Anthropic:
  - intento (descrizione breve)
  - problema
  - outcome atteso
  - utenti impattati
  - vincoli / limiti
  - domande ancora aperte
- Sostituisce le grandi riunioni di raccolta requisiti: è la fase di *information gathering*.

## 05:57 — Dove vivono gli intent

Il file viene committato nel repository (GitHub/GitLab). Tre configurazioni:

1. **Repo del prodotto** — gli intent stanno dentro il repo che si sta sviluppando (più intent da utenti diversi).
2. **Monorepo aziendale** — cartella separata con gli intent, accanto ai prodotti.
3. **Repo dedicato** — un repository a sé che raccoglie solo gli intent.

*(Segue uno spazio promozionale sulla community/corsi dell'autore.)*

## 08:12 — Fase 2: `spec.md`

- Un **product owner / product manager** rivede tutti gli intent (propri e del team).
- Con Claude li trasforma in **`spec.md`**: specifiche tecniche.
- Anthropic fornisce un prompt: rivedere l'intent → produrre i requisiti → produrre lo spec.
- Contenuto dello spec: file coinvolti, **ordine di lavoro**, **rischi**, **verifiche/prove**.
- Tre livelli di automazione:
  1. prompt lanciato a mano dal PM;
  2. **skill** che incorpora le policy aziendali;
  3. **automatico**, avviato da un job della CI.
- Un intent può essere **rifiutato** ("non ha senso"); gli spec accettati vengono mergiati nel repo.

## 10:17 — Fase 3: `plan.md`

- Il team di ingegneri prepara il **`plan.md`** e itera su di esso.
- Criterio di qualità del playbook: un plan fatto bene si può eseguire **da qualunque ingegnere senza
  consultare `spec.md` né `intent.md`**.
- Il playbook descrive anche un workflow di esecuzione del piano.

## 10:53 — Fase 4: verifica

- Raccomandazione centrale: Claude deve avere un modo per **controllare il proprio lavoro**.
  Ciclo: scrive codice → esegue i controlli → se passano è (quasi) finito, se no si corregge e ripete.
- È in questa fase che si dice a Claude quali controlli impostare. Tre famiglie principali (ce ne sono altre):
  1. **Test sulle funzioni** (unit) — verificano le funzionalità a livello di codice.
  2. **Test di componenti UI** (es. React) — un componente chiama più funzioni, non viceversa, quindi va
     testato a parte.
  3. **End-to-end / user experience** (es. Playwright).

## 13:00 — Fase 5: produzione e ciclo chiuso

- Dopo il deploy, Claude **osserva l'applicazione**: log, errori, metriche (es. churn superiore all'atteso).
- Se qualcosa non va, Claude **genera da solo un nuovo `intent.md`** (ecco perché nel diagramma l'intent ha
  anche il simbolo di Claude: non solo intervista, ma crea) e poi uno **`spec.md`**.
- Lo spec torna al product owner per la revisione → il ciclo riparte.
- Risultato: ciclo più *lean*, meno vincolato a team che rivedono il codice; miglioramento continuo.

## 14:51 — Indicazioni finali

- I test li può impostare il team tecnico; Anthropic consiglia di mantenere **20–50 casi d'uso** reali
  che devono funzionare.
- Gli umani **non rivedono il codice riga per riga**: rivedono `intent.md` e `plan.md`, alimentando il ciclo.

## Sintesi

```
chiunque ──brainstorm──▶ intent.md ──PO + Claude──▶ spec.md ──ingegneri + Claude──▶ plan.md
                              ▲                                                      │
                              │                                          Claude: codice + test
                              │                                                      ▼
                     Claude (log, metriche) ◀──────────── produzione ◀──── verifica (unit, UI, e2e)
```

Ruolo umano = revisione degli artefatti testuali (intent, spec, plan), non del codice.
