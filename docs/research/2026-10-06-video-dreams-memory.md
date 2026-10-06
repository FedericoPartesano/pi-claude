# Video: "Karpathy ha appena risolto il più grande problema di Claude" — note

- **Fonte:** https://youtu.be/fnAScahDJWU
- **Canale:** Giovanni Beggiato · 13:25 · pubblicato il 2026-09-25 · italiano
- **Ricavato da:** sottotitoli automatici YouTube (2026-10-06), note per sezione. I sottotitoli storpiano i nomi
  ("Cloud"/"Clodzi" = Claude, "Carpati" = Karpathy, "Antropic" = Anthropic, "Telm" = Tell me); qui sono corretti.
- **Verifica delle affermazioni:** fatta sulle fonti, vedi in fondo.

## 00:00 — La tesi
- Karpathy è entrato in Anthropic "per risolvere il problema più grosso di Claude": ricordare le conversazioni passate
  e non ripetere lo stesso errore due volte.
- La soluzione esiste già, si chiama **Dreams**, ma (dice il video) è riservata alle aziende Enterprise. L'autore se ne
  costruisce una versione propria come skill per Claude Code o Codex.

## 01:01 — I due problemi
1. **Niente contesto tra un progetto e l'altro.** I palliativi (progetti separati, `CLAUDE.md`) funzionano solo in
   parte: si finisce a ricorreggere Claude su cose già decise.
2. **Memory rot**: la memoria si degrada invece di migliorare.

## 02:01 — L'analogia del sonno
- Di giorno il cervello registra tutto (memoria a breve termine); di notte il **consolidamento** decide cosa conta e
  costruisce la memoria a lungo termine.
- Claude ha la memoria a breve termine (le sessioni salvate) ma non il consolidamento: è quello che fa Dreams.

## 03:01 — Dove sta la memoria di Claude Code
- `~/.claude/projects/<progetto>/`: le **sessioni** complete (tutto ciò che è stato detto, comprese chiavi API: il
  video avverte che restano lì) e la **cartella di auto-memoria** con le decisioni prese, che nessuno ripulisce.
- `/memory` mostra tre livelli: istruzioni utente (CLAUDE.md globale), di progetto, auto-memoria.

## 05:03 — Gli effetti del memory rot
- Le memorie si accumulano con **contraddizioni**, e Claude sceglie da solo quale seguire: da qui il "te l'avevo già detto".
- Tre forme:
  - **deriva**: a marzo "script in italiano", a luglio "script in inglese", restano entrambe;
  - **duplicazione**: la stessa preferenza scritta in cinque modi, che occupa contesto a ogni avvio;
  - **informazione mai registrata**: detta in una sessione (es. perché un cliente se n'è andato) ma mai salvata.

## 08:02 — L'architettura della skill "Dreams" fai-da-te
Un orchestratore che chiama tre skill in sequenza:
1. **lookback**: legge *solo le sessioni* e trova cosa si contraddice o cosa è stato deciso;
2. **cleanup**: confronta memoria e sessioni; recupera le informazioni mancanti, unisce i duplicati, risolve le
   contraddizioni e prepara una **proposta**. Va guidato da **eval** (criteri espliciti su cosa tenere e cosa togliere);
3. **tell me**: riassume la proposta in una decina di righe e chiede cosa fare.

## 10:00 — Demo
- Esempio di output: "39 sessioni lette", voci da aggiungere, 7 da unire, alcune da rimuovere, contraddizioni elencate;
  produce un `dream-proposal.md`.
- Lezioni catturate nella demo: "eval prima di consegnare, non dopo la lamentela", preferenze, fatti di progetto.

## 12:01 — Il passo successivo
- Renderlo automatico con una **routine** (esecuzione pianificata): produce `dream-proposal.md`, e solo dopo
  l'approvazione le modifiche entrano nella memoria del progetto.

## Verifica delle affermazioni
| Affermazione del video | Fonti | Esito |
|---|---|---|
| Karpathy è entrato in Anthropic | annuncio su X e TechCrunch, 19/05/2026 | ✅ |
| …"per risolvere la memoria di Claude" | è nel team di **pre-training** (sotto Nick Joseph), per usare Claude nella ricerca di pre-training | ❌ forzatura del titolo |
| Dreams esiste ed è riservato alle aziende | "Dreaming", research preview del maggio 2026 nella **Managed Agents API**: legge memory store + trascrizioni, unisce duplicati, sostituisce voci superate, propone; approvazione automatica o revisione | ✅ ma non è una funzione di Claude Code, è un primitivo API per agenti gestiti |
| "Ha risolto il problema" | Harvey riporta ~6× compiti completati (dato del cliente, non indipendente) | ⚠️ |

## Sintesi
Il video è un buon riassunto del *concetto* (consolidare la memoria tra le sessioni, con proposta e approvazione) ma
lega forzatamente Karpathy a Dreams e presenta come "funzione di Claude riservata" quello che è un primitivo della
Managed Agents API. La ricetta fai-da-te (lookback → cleanup con eval → proposta → approvazione) è ragionevole e
ricalca il modo in cui Anthropic descrive Dreaming.

Fonti: [TechCrunch](https://techcrunch.com/2026/05/19/openai-co-founder-andrej-karpathy-joins-anthropics-pre-training-team/),
[Karpathy su X](https://x.com/karpathy/status/2056753169888334312),
[SiliconANGLE](https://siliconangle.com/2026/05/06/anthropic-letting-claude-agents-dream-dont-sleep-job/),
[Forbes](https://www.forbes.com/sites/jonmarkman/2026/05/11/claudes-new-dreaming-feature-builds-self-improving-ai-agents/),
[MindStudio](https://www.mindstudio.ai/blog/what-is-claude-dreaming-anthropic-managed-agents).
