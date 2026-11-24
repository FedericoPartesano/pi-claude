---
status: in-progress
created: 2026-11-23
source: user
---

# Compressione del contesto guidata dal modello (billion-context-pi)

## Problema
Nelle sessioni lunghe il contesto si riempie e Pi fa un compact che riassume tutto in un colpo: si perdono dettagli e la cache riparte da zero. billion-context (ranxianglei, MIT + attribuzione) fa invece comprimere al modello stesso intervalli di messaggi in riassunti, reversibili (`decompress`) e ricercabili (`search_context`), lasciando intatto il prefisso in cache. Esiste già come estensione Pi (`billion-context-pi`, motore `acp-kernel`), che lavora sull'evento `context` di Pi senza proxy: col nostro bridge la vista compressa arriva a `claude -p` tramite il `--resume` già esistente.

## Decisioni (dal colloquio del 2026-11-23)
- Si copia il funzionamento di billion-context così com'è: decide il modello, con i nudge del kernel.
- Il compact automatico di Pi resta spento (lo annulla l'estensione in `session_before_compact`).
- Prima si usa il pacchetto pubblicato a versione fissata; un adapter nostro sopra `acp-kernel` solo se le misure lo giustificano.

## Outcome atteso
- [x] `billion-context-pi` installato da `install.sh` (e `scripts/setup.mjs`) a versione fissata, con `autoUpdate: false` e `delegate: false` in `~/.pi/acp.json` senza sovrascrivere chiavi dell'utente; test dello script. — prova: `node --test scripts/setup.test.mjs` 10 pass (idempotenza, chiavi utente preservate, profilo `scripts/acp-profile.json` coerente con la versione)
- [x] Prova in pty con haiku: i tool `compress`/`decompress`/`search_context`/`acp_status` passano dal bridge, un `compress` riduce la vista mandata a `claude`, il compact di Pi non parte; contati i riavvii `--resume` del bridge. — prova: `pi --mode json` col bridge (prova rpc, non pty): `compress` 11–12 per run, `acp_status` (t-lim), `search_context` (t-v2na), `search_context`+`decompress` → `1200` (t-dec); contesto vivo max 81k contro 124k; compact di Pi 0 contro 2; bridge 26–27 spawn / 25–26 `--resume` contro 20/15 (`eval/fold/REPORT.md` §5)
- [x] Nessun conflitto con `pi-memory`, `lean-tools`, `pi-team`, `pi-ui` (tool, prompt, scorciatoie `ctrl+alt+f` ecc.); suite estensioni verde. — prova: vedi intent `2026-11-23-ok-in-auronomia-usando-le-agent.md`: suite 575 pass, fallimenti preesistenti o di carico documentati; pi-team e pi-ui non registrano tool o tasti in comune con billion-context
- [x] Misura in `eval/fold/REPORT.md`: stessa sessione lunga con e senza, token totali, cache hit, riavvii del bridge, costo fisso di prompt per turno (tag `<acp>`, descrizioni dei tool), qualità delle risposte dopo i fold; riportata anche se negativa. — prova: `eval/fold/REPORT.md` (costo fisso +6.549 token/richiesta col profilo lean; 6 run a turni: token +3…17%, hit 0,65–0,69 contro 0,59–0,60, recall 1 run su 4)
- [x] Decisione scritta su tenere il pacchetto o scrivere un adapter nostro, con motivo dai numeri. — prova: billion-context resta predefinito col profilo v2 (decisione dell'utente, confermata dai numeri: costo pesato −15%, contesto vivo −35%, recall 7/7 contro 0/7 senza archivio); `eval/fold/REPORT.md` Conclusione
- [x] Attribuzione a billion-context nel README (richiesta dalla licenza) e wiki aggiornata. — prova: README sezione billion-context con attribuzione MIT; wiki: `vault/wiki/entities/billion-context-pi.md` e pagine collegate
- [x] Difetti trovati con una chat lunga (29 turni con ripresa) corretti e rimisurati: tool result alla ripresa, JSON malformato a `compress`, evizione del pool a metà tool call, riavvio del bridge a ogni troncatura d'emergenza, costanti di file descritti a parole. — prova: run N in `eval/fold/results.txt`, vB contro off: costo pesato 0,988M contro 1,104M (−10,6%), spawn 8 contro 15, compact di Pi 0 contro 4, recall 14/14 prima e dopo il `RESTART` in tutte e 4 le run, 0 `diverged at 1/` nel log; `node eval/fold/check.mjs` exit 0; test `pi-claude-code` 39 pass + tsc, `extensions/archivio.test.ts` 19 pass; `eval/fold/REPORT.md` §6
- [x] Perdita di processi `claude` dopo `compress` corretta (sessione in attesa di un tool il cui risultato Pi manda a un'altra sessione: occupata per sempre, mai chiusa) e rimisurata sul pagliaio da 158 turni. Corretta in `idle-reaper.ts` `closeOrphaned` + `provider.ts` (test 40 pass + tsc); manca la rimisura: le run H1 in corso usano il codice vecchio (H1-bc 21 processi vivi su 22 spawn). — prova: H1-bc-rn, 158 turni, 35 avvii e nessun processo vivo a fine run; 871 s contro 6.895 s (REPORT §7).
- [x] I valori aggiornati dall'utente (porta, scadenza) tornano col valore nuovo — prova: test `factRecall` in `extensions/archivio.test.ts`; due replay dei quiz H1 con 9124 e 7 gennaio corretti, 18/19 secondo lo scorer corretto per i replay; 19/19 con `constSearch` (REPORT §7).
- [x] Spinta al recall: dopo un'astensione senza ricerca su contesto compresso, una sola continuazione che chiede `search_context` (`extensions/recall-nudge.ts`) — prova: 6 test verdi in `extensions/recall-nudge.test.ts`; ripresa di H1-bc, quiz 2 da 6/9 a 7/9 con 4 `search_context` e 1 `decompress`, +69k token pesati (REPORT §7).
- [ ] Prova manuale dell'utente nel TUI reale con una sessione lunga.

## Vincoli
- Token al primo posto: costo fisso per turno misurato prima di dichiarare un risparmio.
- Niente auto-update di terzi: la versione la fissa la repo.
- Nessun commit o push senza richiesta esplicita.
