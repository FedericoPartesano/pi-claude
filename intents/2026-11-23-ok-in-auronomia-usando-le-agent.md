---
status: done
created: 2026-11-23
source: user
---

# billion-context che risparmia token e allarga la memoria (lavoro autonomo, misure empiriche)

## Problema
billion-context-pi è attivo di default (`scripts/setup.mjs`), ma le misure in `eval/fold/REPORT.md` dicono che oggi costa più token di Pi senza (+3…17%) e non richiama meglio i dettagli: i nudge partono al 45–75% di 200k (contesto vivo 134–144k), il prompt fisso aggiunge +6,5k token per richiesta, il modello non usa `decompress`, e `extensions/archivio.ts` non indicizza più nulla perché il compact di Pi viene annullato. L'obiettivo dell'utente: con billion-context si spendono meno token e la memoria della sessione diventa molto più ampia grazie alla decompressione dinamica. Va testato empiricamente, consumando pochi token nelle prove.

## Outcome atteso
- [x] Profilo `scripts/acp-profile.json` con soglie di compressione basse (contesto vivo piccolo) e prompt fisso accorciato; il costo fisso per richiesta misurato e riportato. — prova: profilo con `modelContextLimit` 100000, `preserveRecentTools: ["read"]`, HOW TO COMPRESS corto, THROTTLE/BREAKDOWN tolte; `node --test scripts/setup.test.mjs` 10 pass; costo fisso 31.103 token/richiesta contro 33.133 del lean e 26.586 di off (`eval/fold/REPORT.md` §1)
- [x] Il modello recupera i dettagli compressi: `decompress`/`search_context` usati davvero quando serve un valore esatto (nudge/prompt sistemati), oppure richiamo automatico. — prova: richiamo automatico `keyRecall` dell'archivio; run t-v2 (billion-context, haiku) 7/7 valori esatti dopo 11 `compress`; `decompress` dal modello funziona su richiesta (run t-dec: search_context → decompress → `1200`), ma non lo usa spontaneamente (run lean/full: 0 chiamate)
- [x] `extensions/archivio.ts` indicizza anche il contenuto compresso da billion-context (ponte compress → archivio), con test. — prova: `foldedIds` legge `<sessione>.acp.json`, `archivedEntries(branch, folded)`, re-indice su `tool_result` di `compress`, `keyRecall`; `node --test extensions/archivio.test.ts` 17 pass; offline sulle sessioni t-lean/t-full2 7/7 valori nell'iniezione
- [x] Banco empirico economico in `eval/fold/` con storia che supera la finestra viva di molto: off vs billion-context migliorato, ≥ 3 run per configurazione (o motivo scritto se meno), token totali, contesto vivo massimo, recall. — prova: `eval/fold/turns.sh` (14 file, storia ~190k token, 2,4× il contesto vivo), 3 run off (t-off3/4/5) e 3 run v2 (t-v2/3/4) più una coppia senza archivio automatico (t-offna/t-v2na); tabelle in `eval/fold/REPORT.md` §5, numeri grezzi in `eval/fold/results.txt`
- [x] Risultato misurato: billion-context migliorato spende meno token totali di off sullo stesso banco. — prova: media di 3 run: token in totali 2,558M contro 2,612M (−2%), cacheWrite −28%, costo pesato 1,282M contro 1,515M (−15%, più basso in tutte e 3 le run); `eval/fold/REPORT.md` §5
- [x] Risultato misurato: billion-context migliorato richiama più valori esatti di off dopo le compressioni (memoria più ampia). — prova: senza archivio automatico t-v2na 7/7 contro t-offna 0/7; con archivio v2 7/7 in 3 run su 3, off 6,7/7 di media; `eval/fold/REPORT.md` §5
- [x] Nessun conflitto con le altre estensioni (`pi-memory`, `lean-tools`, `caveman`, `context-tiers`, `archivio`); suite delle estensioni verde (salvo guasti ambientali preesistenti documentati). — prova: suite `node --test extensions/*.test.ts pi-memory/test/*.test.ts scripts/*.test.mjs`: 575 pass, 4 fail. `rpc-processes` fallisce anche con `git stash` (preesistente); `voice` (7 pass), `async-build` e `deep-scale` passano da soli (fallivano per il carico dei 5 banchi in parallelo); `dashboard-tui` per `@earendil-works/pi-tui` mancante (preesistente). caveman e lean-tools adattati con test; archivio 17 pass
- [x] Prova in pty/rpc: compress e decompress passano dal bridge `claude -p`, il compact di Pi non parte. — prova: `pi --mode json` col bridge su copia della sessione t-v2 (`/tmp/bc-bench/t-dec`): search_context + decompress eseguiti, risposta `1200`, 2 `--resume` del bridge, 0 `compaction_start`; nei run t-lim/t-v2 11–14 `compress` e `compaction` vuoto (off: 2)
- [x] `eval/fold/REPORT.md` aggiornato con tutte le tabelle, anche i risultati negativi; intent precedente (`2026-11-23-compressione-contesto-billion-context.md`) aggiornato con le prove. — prova: `eval/fold/REPORT.md` §1 (riga v2) e §5 (tabelle off/v2, senza archivio, prova decompress, bridge più riavvii come risultato negativo), Conclusione riscritta; intent precedente con 5 voci spuntate
- [x] Wiki (`vault/`) aggiornata secondo `vault/schema.md`. — prova: creati `vault/wiki/sources/partesano-2026-eval-fold.md`, `entities/billion-context-pi.md`, `comparisons/compact-pi-vs-billion-context.md`; aggiornati `extension-archivio`, `decisioni-di-progetto`, `index.md`, voce ingest in `log.md`; nessun link rotto

## Utenti e sistemi impattati
- Chi installa pi-claude (`install.sh` → `scripts/setup.mjs` → `~/.pi/acp.json`).
- Bridge `pi-claude-code` (`--resume`, cache), estensioni `archivio`, `caveman`, `lean-tools`, `context-tiers`, `pi-memory`.

## Vincoli
- Token al primo posto, anche nelle prove: modello haiku, banchi corti dove basta.
- Niente auto-update di terzi; versione fissata dalla repo. Licenza MIT con attribuzione.
- Nessun commit o push senza richiesta esplicita.
- Ogni affermazione su token o qualità misurata e riportata in `eval/`.

## Domande aperte
- Le soglie ottime dipendono dalla finestra (200k): quanto piccolo può stare il contesto vivo senza troppi fold (ogni fold riscrive la cache)?
- Basta il profilo `acp.json` o serve un adapter nostro sopra `acp-kernel`?

## Verifica
```bash
node --test scripts/setup.test.mjs extensions/archivio.test.ts extensions/caveman.test.ts extensions/lean-*.test.ts
node eval/fold/check.mjs   # offline sui run registrati; il banco dal vivo (eval/fold/turns.sh, ~2,6M token) si rilancia solo a mano
cat eval/fold/REPORT.md
```
