# Alternative
Aggiornato: 2026-10-26 · fase 4

## Raccomandazione
Nessuna candidata passa il filtro portante (quota ≥30% in meno nella simulazione): la raccomandazione è **il controllo da eseguire**, non una candidata. Il controllo: ricalibrare la simulazione (oggi prevede 7 compattazioni, le reali sono 10), rifarla sulla seconda sessione e verificare se Pi può inviare il riassunto con il prefisso della conversazione (leva D). Poi la scelta tra C e D.
Non contraddice un'idea iniziale (il brief non ne aveva).

## Misura usata (simulazione, non fatturazione)
`sim-compattazione.js` rigioca i 182 giri del Mac (06:26–07:17) con peso per token: input 1, cacheRead 0,1, cacheWrite 1,25, output 5 (rapporti dei prezzi API; il conto reale dell'abbonamento non è noto). Finestra 200k, ricaduta a 70k, riassunto medio misurato (24,3k output, 49,5k cacheWrite). Limiti: la base prevede **7** compattazioni contro **10** reali (crescita per giro sottostimata ~20%); un solo pacchetto; il peso di output è decisivo (fino al 66% del costo di una compattazione).

| Variante | Compattazioni | Costo | Rispetto alla base |
|---|---|---|---|
| Base (`reserveTokens` 80000) | 7 | 4458k | — |
| `reserveTokens` 60000 / 40000 / 30000 / 16384 | 5 / 4 / 3 / 3 | 4108k / 3955k / 3809k / 3817k | −7,8% / −11,3% / −14,5% / −14,4% |
| Base + riassunto con tetto 8k di output | 7 | 3886k | −12,8% |
| 30000 + riassunto 8k | 3 | 3564k | −20,0% |
| 30000 + riassunto 8k + riassunto che legge la cache (cacheWrite 5k) | 3 | 3397k | −23,8% |
| Crescita per giro ×0,6 (risultati dei tool più corti), 80000 | — | 3535k | −20,7% |
| Crescita ×0,6 + 30000 + riassunto 8k | — | 3173k | −28,8% |
| Immagini: 3,7 in contesto in media (≈2.800 token) | — | 51k | ≈1% |

Lettura: nessuna leva sola arriva al 30%; le immagini pesano ~1% della quota in questa sessione (non è la leva della quota; resta quella dei pacchetti e dei limiti di dimensione). Il 52% dei caratteri dei risultati dei tool sta in risultati sopra 12k caratteri.

## Candidate
### A — Solo impostazioni
- Invarianti che fissa: `reserveTokens` 30000 (e `keepRecentTokens` invariato) in `settings.json`; nessun codice.
- Seme minimo: una riga in `~/.pi/agent/settings.json`, anche sul Mac (valore sul Mac non noto: da verificare).
- Dove vive lo stato: impostazioni di ciascuna macchina.
- Come evolve: a mano; ogni macchina può divergere.
- Da quali repo prende: opencode (tetto = finestra − max(15%, 16k)), `20-repo/opencode.md`; il nostro 80000 è il caso di #58774.
### B — Estensione "compattazione frugale"
- Invarianti che fissa: l'estensione risponde a `session_before_compact` (`SessionBeforeCompactResult.compaction`, `upstream/.../extensions/types.ts:1284`) con un riassunto **a tetto di output** (~8k), **al massimo 2 tentativi** e stop dopo `refusal`, rapporto minimo (non compatta se libera poco), più reserve dinamico (≥15% della finestra, come opencode); immagini tolte a due soglie 25/15 MiB.
- Seme minimo: `extensions/compact.ts` + test; il riassunto lo chiama l'estensione stessa.
- Dove vive lo stato: contatore di tentativi in memoria della sessione; nessun file.
- Come evolve: parametri in `settings.json`; estensione disattivabile con una variabile.
- Da quali repo prende: OpenHands (5 tentativi, rapporto minimo), opencode (tetto e immagini), codex (non ritentare allo stesso modo).
### C — B + tetto ai risultati dei tool nuovi
- Invarianti che fissa: oltre a B, ogni risultato di tool sopra 12.000 caratteri entra nel contesto con testa+coda e l'integrale va su disco (percorso nel testo), come fa già `context-tiers` per i vecchi.
- Seme minimo: ampliare `extensions/context-tiers.ts`/`lean-tools.ts` (hook sui risultati).
- Dove vive lo stato: file integrali in una cartella della sessione.
- Come evolve: soglia unica `PI_TIERS_*`.
- Da quali repo prende: gemini-cli (`nodeTruncationProcessor`, riduzione a nodi), opencode (tagli a 2.000 caratteri nelle trascrizioni).
### D (emersa) — C + riassunto che legge la cache
- Invarianti che fissa: la richiesta di riassunto ha lo stesso prefisso (system prompt e storia) della conversazione, come opencode e Claude Code.
- Seme minimo: dipende da come il bridge `claude -p` persistente può ricevere il prompt di riassunto nello stesso processo (non verificato).
- Dove vive lo stato: processo `claude` persistente.
- Come evolve: fragile rispetto agli aggiornamenti di Claude Code.
- Da quali repo prende: opencode `compaction.ts:434-438`.

## Esito di tradeoff
### Verdetti
| Candidata | Quota (40, portante) | Qualità (30) | Affidabilità (20) | Manutenzione (10) |
|---|---|---|---|---|
| A | fail(−14,5% simulato, sotto 30%) | pass (nessun cambio di contenuto; prova: la compattazione resta quella di Pi) | unknown(il refusal e il ciclo restano; controllo: un caso con il log v0.9.0) | pass (una riga) |
| B | fail(−20,0% simulato) | unknown(riassunto da 8k perde dettagli? controllo: compiti a risposta nota sulla sessione del Mac) | pass solo per ciclo/refusal (tetto tentativi, stop su refusal: prova nel codice di OpenHands `llm_summarizing_condenser.py:359`, non ancora nostra) | unknown(codice in più, hook `session_before_compact`) |
| C | fail per un soffio(−28,8% simulato, errore stimato ±20%) | unknown(tagliare risultati nuovi può togliere ciò che il modello leggeva: controllo: compiti a risposta nota) | come B | unknown |
| D | unknown(−23,8% senza C, ~−35% con C: fattibilità non verificata) | come C | come B | fail(fragile: dipende dal processo persistente) |

### Sopravvissuti ed esclusi
- Esclusa A: fail su quota (−14,5%).
- Esclusa B: fail su quota (−20,0%).
- C: fail per un soffio, **con margine d'errore più largo della distanza dalla soglia** → il controllo che la riammette è la ricalibrazione.
- Fuori per unknown D: verifica se Pi può mandare il riassunto sul processo persistente con lo stesso prefisso.
- Nessun sopravvissuto: **nessun critico lanciato** (la skill ne prevede 2 per i sopravvissuti; costo risparmiato).

### Trade-off ceduti
Rinunciare a una soluzione solo-impostazioni significa scrivere codice e accettare che il 30% dipenda da tagli di contenuto (riassunto più corto, risultati tool più corti), con rischio sulla qualità.

### Falsificatore
Se la simulazione ricalibrata (7→10 compattazioni) e rifatta sulla seconda sessione dà per C meno del 30%, la soglia non è raggiungibile con la sola gestione del contesto: allora o si abbassa la soglia o si agisce su altro (modello, effort, abitudini d'uso). Termine: prima della scelta della seconda sessione.

### Difesa
- Numeri: tabella sopra, `sim-compattazione.js` su `/tmp/bugs-in/6adf07c7375ca4c4fef75ed5/`.
- CacheRead 0 e dimensioni del riassunto: `05-territorio.md` §6.
- Fallback e tentativi: `20-confronto.md`.

### Rischi e unknown residui
- Il peso dell'output (×5) è un'ipotesi: se il conto dell'abbonamento pesa l'output meno, tutte le leve sul riassunto valgono meno.
- La simulazione sottostima le compattazioni (7 contro 10) e usa una sessione sola.
- L'effetto sulla qualità di riassunto a 8k e di tagli ai tool non è misurato.
