Aggiornato: 2026-10-26 · fase 4

# Gestione del contesto in Pi

## Problema
Il contesto di Pi si riempie in fretta e costa quota: l'utente ha usato il 76% del limite settimanale. Si vuole sapere se la gestione del contesto è giusta e se si può migliorare.

## Decisioni dell'utente (fase 0)
- Dolore: **quota** (76% settimanale usato).
- Perimetro: prompt fisso, output dei tool, ricordi iniettati, politica di compattazione, **immagini nel contesto** (aggiunto il 2026-10-26 su richiesta dell'utente). Fuori: `/dream` e cambio modello.
- Profilo di spesa: **default** (3 ricerche, 4 repo, 2 critici).

## Vincoli già decisi
- Non riscrivere né comprimere il contesto già inviato: la cache si rifà e costa di più (+19,6%), decisione #r25.
- Costo fisso in token il più basso possibile, righe di prompt corte e stabili (CLAUDE.md).
- Ogni affermazione su prestazioni va misurata e riportata in `eval/`.

## Decisioni dell'utente (fase 1, primo round)
- Risultato atteso: **tutti e tre**, misurati insieme: (1) meno token per una sessione di lavoro tipo, stessa attività e qualità invariata; (2) meno compattazioni per ora; (3) sessioni lunghe usabili senza rifiuti o blocchi.
- Modo di fallimento: **una sessione tipo non consuma meno quota** con soglia **30%**: se il consumo non scende di almeno il 30% rispetto a oggi, la soluzione non funziona.
- Pesi degli scenari: **quota 40, qualità 30, affidabilità 20, manutenzione 10**.
- Loop di compattazione di stamattina: **dentro lo studio come caso portante** (dati in `05-territorio.md`).

## Decisioni dell'utente (fase 1, secondo round)
- Sessione tipo: **due sessioni registrate rigiocate offline**: quella del Mac del 2026-10-26 (pacchetto ridotto, `/tmp/bugs-in/6adf07c7375ca4c4fef75ed5/`, da copiare in un posto stabile) e una sessione di questo repo. Costo in quota zero, risultato ripetibile.
- Soglia: **almeno 30% in meno di token**.
- Qualità: **compiti a risposta nota** sul contesto ridotto (es. "quale file hai letto prima?", "cosa avevamo deciso?"), con la risposta verificabile nel file di sessione.

## Scenari di qualità
1. Quota (40, `portante`): token totali per sessione tipo, prima e dopo, stessa attività.
2. Qualità (30): il modello non perde file letti né decisioni dopo il taglio; compiti a risposta nota.
3. Affidabilità (20): niente loop di compattazione, niente blocco su un refusal; numero di compattazioni per ora.
4. Manutenzione (10): l'utente non deve toccare impostazioni a mano; costo fisso del prompt invariato o minore.

## Aperto
Seconda sessione di riferimento (repo pi-claude): da scegliere tra quelle in `~/.pi/agent/sessions/` (12 ott 8,4 MB, 14 ott 3,8 MB). Serve prima della misura, non della ricerca.
Candidate: fase 4 fatta (`30-alternative.md`): A impostazioni, B compattazione frugale, C = B + tetto ai tool, D (emersa) = C + riassunto con cache. Nessuna passa il 30% nella simulazione.
