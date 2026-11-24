---
status: done
created: 2026-11-23
source: user
---

# Migliorare pi-claude in autonomia con le agent skills (mezz'ora)

## Problema
Dopo l'integrazione di billion-context restano difetti noti e codice scritto in fretta: un test rosso nella suite (`eval/round2/test/workdir.test.mjs`), il modello che nei quiz usa `bash` sui dump di `decompress`, codice nuovo (`factRecall`, `recall-nudge`, `idle-reaper`) mai rivisto con calma. L'utente chiede mezz'ora di lavoro autonomo guidato dalle agent skills, con risultati e miglioramenti annotati man mano in un file md.

## Outcome atteso
- [x] Registro `eval/fold/miglioramenti-autonomi.md` aggiornato a ogni passo: ora, skill usata, cosa è stato trovato, cosa è cambiato, prova. — prova: file con 9 voci datate 15:14–15:27, ognuna con skill, rilievo, modifica e misura.
- [x] Revisione del codice di oggi con la skill `code-review-and-quality` (`archivio.ts` factRecall, `recall-nudge.ts`, `idle-reaper.ts`/`provider.ts`): ogni rilievo corretto con un test o motivato come non da correggere nel registro. — prova: voci 15:16 e 15:22 del registro. Falsi positivi 0 su 448 turni (`/tmp/nudge-fp.mts`, `/tmp/fr-real.mts`); `closeOrphaned` motivato come non da cambiare; difetti `UPDATE_CUE` e `onUsed` corretti con test.
- [x] Test rosso `eval/round2/test/workdir.test.mjs` corretto con la skill `debugging-and-error-recovery` (causa trovata, test verde). — prova: causa `git init` con ramo iniziale `main` (git 2.54) → `git init -q -b unborn`; `node --test eval/round2/test/workdir.test.mjs` pass 1, fail 0.
- [x] Almeno 3 miglioramenti in TDD (skill `test-driven-development`), ciascuno con test prima rosso e poi verde. — prova: 4 test visti rossi e poi verdi (aggiornamenti a catena, budget stretto, astensioni inglesi, `onUsed` solo per ciò che è inviato); `archivio.test.ts` + `recall-nudge.test.ts` pass 29, fail 0.
- [x] Suite completa verde a fine lavoro (esclusi i test instabili già noti, elencati nel registro). — prova: 1.139 passati, 9 saltati; unico fallimento `memory-worker` per timing sotto carico (32 ms contro 30), non toccato, verde 3 volte su 3 da solo, elencato nel registro; bridge 40/40.
- [x] Durata di circa 30 minuti: ora di inizio e di fine nel registro. — prova: inizio 15:14 e fine 15:27 nel registro; il piano si è esaurito in 13 minuti, il resto richiede decisioni dell'utente o run costose.
- [x] Consigli per i passi successivi in fondo al registro. — prova: sezione «Consigli per i passi successivi» con 6 voci nel registro.

## Utenti e sistemi impattati
- Chi usa pi-claude con billion-context attivo di default (archivio, spinta al recall, bridge).
- Suite di test e banchi in `eval/`.

## Vincoli
- Token al primo posto: nessuna run lunga del pagliaio (servirebbe l'ok dell'utente); prove offline o replay brevi con haiku.
- Ogni affermazione su qualità o costo misurata e riportata.
- Commit locali per tema; push solo se lo stato è solido e provato (regola data dall'utente), mai bump di versione.
- Non toccare `~/.claude`, `rc-state.ts`, il pacchetto `billion-context-pi` (versione fissata).

## Domande aperte
- Nessuna bloccante: dove un rilievo cambierebbe il comportamento visibile, si annota nel registro invece di decidere.

## Verifica
```bash
cd ~/Documents/projects/strumenti-ai/pi-claude
test -f eval/fold/miglioramenti-autonomi.md
node --test eval/round2/test/workdir.test.mjs
PI_ARCHIVE_SEM=0 node --test extensions/archivio.test.ts extensions/recall-nudge.test.ts
(cd pi-claude-code && node --test test/*.test.ts)
```
