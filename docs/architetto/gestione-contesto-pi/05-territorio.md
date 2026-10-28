Aggiornato: 2026-10-26

# Territorio: cosa è stato misurato

## 1. Prompt fisso (misurato il 2026-10-26, da `~/.pi/agent/sessions/`)
Primo giro: 18.828 token. Stima a caratteri/3,6.
- Skill 5.389; schemi dei 19 tool 4.559; project_context 899; rules 611; docs 390; memory 351; ~6.000 non attribuiti.
- Con `disable-model-invocation: true` su 22 skill la sezione skill è passata da 30 a 7 skill (19.400 → 4.092 caratteri, ~−4.250 token). `/skill:nome` resta richiamabile.
- `ask_user_question` pesa 1.063 token (5,6%): lasciato.
- Il prompt fisso è meno di un terzo del contesto di una sessione di 62k token: la crescita viene dalla conversazione.

## 2. Loop di compattazione (bug `6adf0853…` e `6adf07c7…`, Mac, Pi 1.4.0, pi-claude 0.8.0)
Dati dal pacchetto ridotto a mano (627 voci dalle 06:00Z del 2026-10-26; la sessione intera è 147 MB, 10192 voci, 113 compattazioni).
- 10 compattazioni tra 06:26 e 07:17, una ogni ~5 min, ciascuna a 120–133k token.
- Dopo ogni compattazione il primo giro è a 65–75k: prompt fisso ~19k + riassunto 16–18k + coda recente ~30k. Margine fino alla soglia: ~50k, cioè 5–6 `read` da 5–9k.
- Il riassunto non cala: 56–69k caratteri a ogni giro (riassume il riassunto precedente più il lavoro nuovo).
- Soglia di Pi: `contextTokens > contextWindow − reserveTokens` (`upstream/.../compaction/compaction.ts:291`). Default `reserveTokens` 16384, `keepRecentTokens` 20000. Su questo PC `reserveTokens` è 80000, quindi ~120k con finestra 200k: coincide con i dati. **Sul Mac non verificato.**
- Costo: una compattazione campione ha 21k token in uscita e 35k in scrittura di cache; dopo di essa la cache va rifatta (~70k token ogni 5 min, stima non misurata sulla quota).
- Alle 07:43:50 la compattazione fallisce con `stop_reason refusal`, seguita da tre "Operation aborted" (07:43:40, 07:43:55, 07:52:05). Contesto già sopra soglia: ritenta a ogni giro.
- Risultati dei tool nel pacchetto: `read` ~140k token, `bash` ~70k, 38 immagini (~57k a ~1.500 l'una, stima). Le riletture di file non sono misurate: il 11% calcolato in precedenza era sbagliato (contava il base64 delle immagini).

## 3. Immagini nel contesto (sessione del Mac, misurato il 2026-10-26)
- 38 immagini nei risultati dei tool, tutte PNG 440x978 (screenshot di un telefono), 29–129 KB l'una: 5,89 MB di base64 su 8,81 MB di `session.jsonl`, cioè il **67% del file**. Il pacchetto di bug le porta due volte (`session.jsonl` e `branch.json`).
- Costo in token: ~29.000 totali con la formula larghezza×altezza/750 (stima mia, circa 760 l'una; non misurata sulla fatturazione). Correzione: prima avevo stimato ~57k a 1.500 l'una, era troppo.
- Pi: `images.autoResize` (default true, massimo 2000x2000) e `images.blockImages` (default false). 440x978 è già sotto il tetto, quindi non cambia nulla. Per la compattazione Pi stima un'immagine a 4800 caratteri (~1.300 token; `compaction.ts:298`).
- Nel repo non c'è nessuna riduzione né ricompressione delle immagini: i `resize` trovati servono solo a disegnare le miniature nel terminale (`pi-ui/src/images.ts`).
- **Le immagini non vanno nel riassunto** (letto nel sorgente di Pi): `generateSummaryWithUsage` (`compaction.ts:747-748`) converte i messaggi in testo con `serializeConversation` (`compaction/utils.ts:109`), che usa `contentText` e tiene solo i blocchi `text`. I risultati dei tool sono tagliati a 2000 caratteri (`TOOL_RESULT_MAX_CHARS`). Quindi le immagini non c'entrano col `refusal`, e dopo la compattazione il loro contenuto sparisce: resta solo il testo che le circondava.
- Le 35 voci `pi-ui-image` pesano 0,01 MB: non portano i pixel.

## 4. Meccanismi esistenti
- `extensions/context-tiers.ts`: riduce a digest (testa 700 + coda 300 caratteri) gli output vecchi dei tool. `PI_TIERS_LIMIT` 30000 token, `PI_TIERS_KEEP` 8 turni, spento con `PI_CONTEXT_TIERS=0`. Non verificato se sia scattato nel pacchetto del Mac.
- `extensions/lean-tools.ts` + `extensions/lean/reread.ts`: le riletture di file invariati diventano una nota breve fino alla compattazione.
- `extensions/caveman.ts:101`: compattazione con timeout proprio (`COMPACT_TIMEOUT_MS`); ruolo nel loop non esaminato.

## 5. Ricerca della causa del refusal (2026-10-26)
- Un solo refusal reale in tutte le sessioni di `~/.pi/agent/sessions/`: quello del Mac (07:43:50). Gli altri riscontri di "declined to answer" sono falsi positivi (`ask_user_question`: "User declined to answer questions").
- Il fallimento è nel riassunto del **prefisso del turno** ("Turn prefix summarization"), cioè del turno in corso diviso a metà.
- Testo che ha preceduto il rifiuto (93 voci dopo la compattazione delle 07:17, ~19k token serializzati): lavoro su un'app di controllo remoto (`remote-control`): lettore QR, token di accesso (`rcd_…`, `mesh.key`), `javap` su librerie, 22 occorrenze di "segreto", 21 di "token", 21 di "shell", 9 di "password", 7 di "reverse".
- Ipotesi, **non provata**: il riassunto presenta come testo semplice, senza il contesto d'uso, comandi e segreti di uno strumento di accesso remoto, e il classificatore di sicurezza rifiuta. Il pacchetto non contiene la richiesta di riassunto, quindi non si può riprodurre.

## 6. Il riassunto di Pi legge la cache? Misurato (2026-10-26, pacchetto del Mac)
Le entry `compaction` portano il `usage` della richiesta di riassunto. Dieci compattazioni, 06:26–07:17:
- **cacheRead = 0 in tutte e 10.** Il riassunto non legge mai la cache della conversazione: conferma l'inferenza di `10-ricerca.md` D2.
- cacheWrite per compattazione: 35–64k (media ~50k, totale 495k). Non ~120k: Pi serializza la storia in testo con i risultati dei tool tagliati a 2000 caratteri, quindi la richiesta è più piccola del contesto.
- Output per compattazione: 21–28k (media ~24k, totale 243k). Più alto dei 16–18k del riassunto salvato: il resto è probabilmente ragionamento del modello (non verificato).
- Primo giro dopo ogni compattazione: cacheRead 17.773 (solo prompt fisso) e cacheWrite 47–68k: la conversazione ripartita si riscrive tutta.
- Confronto con il lavoro normale nella stessa ora (182 giri): output 103k, cacheRead 17,0M, cacheWrite 973k. Le compattazioni sono il **70% dell'output totale** (243k su 346k) e il **34% delle scritture di cache** (495k su 1,47M). Il peso in quota dipende dai prezzi relativi e non è calcolato qui.
- Limite: il campo `usage` della compattazione è quello dichiarato da Pi; non verificato sul conto reale dell'abbonamento.
