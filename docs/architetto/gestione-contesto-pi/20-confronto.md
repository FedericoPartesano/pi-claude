Aggiornato: 2026-10-26 · fase 3

# Confronto repo di riferimento
Problema: compattazione costosa e a ciclo in Pi (10 compattazioni/50 min, cacheRead 0, output 24k ciascuna, nessun tetto ai tentativi, immagini mai potate). Licenze accettate: MIT, Apache-2.0. Profili: `20-repo/`.

| | opencode | codex | gemini-cli | OpenHands SDK |
|---|---|---|---|---|
| Approccio | riassunto in anticipo (85%) tenuto da parte, scambiato a soglia; richiesta con prefisso identico (legge la cache) | compattazione remota; ritento con altro modello se fallisce | pipeline di processori; riassunti piccoli e frequenti con modello economico | condenser per numero di eventi; rapporto minimo; reset duro con 5 tentativi |
| Invarianti | non rompere la cache fino a quando serve; tetto = finestra − max(15%, 16k) | ritentare solo se cambia il modello | primo prompt mai riassunto | `keep_first`; condensare solo se rende abbastanza |
| Immagini | tolte le più vecchie sopra 25 MiB fino a 15 MiB, con taglio a gradini | budget per immagine, unità atomica | non letto | non letto |
| Licenza / copiabile | MIT / sì | Apache-2.0 / sì | Apache-2.0 / sì | MIT / sì |
| Salute | 221k★, push oggi, 37% primo contributore | 131k★, 24k aperte | 108k★ | 1,3k★ (SDK) |
| Dolori noti | cicli di compattazione (#50474, #54993, #56350), `buffer` alto (#58774), degrado dopo molte catene (#50103) | quota anomala (#41220) | non letti | non letti |
| Cosa copiare | anticipo + scambio; `boundImages`; controllo di spazio utile | fallback di modello dopo fallimento | modello piccolo per il riassunto | tetto di tentativi + rapporto minimo |

## Lettura per lo studio
1. **Il nostro ciclo ha un gemello**: opencode #50474/#54993/#56350 e #58774 (`buffer` alto = `reserveTokens` 80000 su Pi).
2. **Tre leve copiabili, tutte nel codice di Pi o in un'estensione, non nel bridge**: (a) tetto ai tentativi e rapporto minimo (OpenHands); (b) anticipo del riassunto con scambio a soglia (opencode); (c) potatura immagini a due soglie (opencode).
3. **Fallback di modello dopo refusal** (codex) risponde al caso Mac; il rischio è che un modello più debole riassuma peggio.
4. **Leva non copiabile**: riassunto che legge la cache. Dipende dal fatto che Pi invii la richiesta di riassunto col prefisso della conversazione; col bridge `claude -p` non è verificato.

## Query eseguite
- `gh search repos` × 3 (tema, "context compaction", "context window management"): quasi solo rumore.
- `gh search code "compact" --filename compaction`: file Go/DB non pertinenti.
- Candidati noti verificati con `gh api`: opencode, codex, aider, cline, goose, gemini-cli, OpenHands.
- `gh api .../git/trees` + grep su `compact|condens|summar|prune|truncat` nei 4 scelti.
- `gh search issues "compaction"` su opencode e codex.

## Canali muti
Discovery per tema e per codice: muti. Awesome list e deps.dev non provati. Fork attivi non guardati.

## Non letti (limite dichiarato)
Aider (push 2026-05, meno attivo), cline, goose: scartati per tempo; Scorecard e advisory non eseguiti per nessun repo; dolori di gemini-cli e OpenHands non letti.

## Segnalazioni per l'ignoto
- opencode: «riassunto in anticipo» richiede un riassunto a ogni salita di soglia: costa output anche se poi non serve. Va misurato su una sessione tipo.
- Il riassunto con prefisso identico nel bridge: verificare se Pi può inviare la richiesta di riassunto come normale turno con il system prompt della conversazione.

Verificati a campione: https://github.com/anomalyco/opencode/blob/5bf3e82f71817493b997cd011467d0a7a8984bd8/packages/core/src/session/compaction.ts#L134 ✓ (`RESERVE_SHARE = 0.15`) · https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/core/src/compact_model_fallback.rs#L9 ✓ · https://github.com/OpenHands/software-agent-sdk/blob/ab0fbb4b5a456f3df0a03df1bc50dd850725d8bd/openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py#L359 ✓
