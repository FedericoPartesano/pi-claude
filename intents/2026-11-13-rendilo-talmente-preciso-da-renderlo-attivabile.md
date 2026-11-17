---
status: done
created: 2026-11-13
source: user
---
# Router delle skill abbastanza preciso da essere attivo di default

## Problema
Il router v2 (`extensions/skills-router.ts`, `skills/router.json`) ha precisione 63% sull'holdout di messaggi reali (45% in v1): troppo bassa per attivarlo da solo, perché ogni falso positivo costa ~3,3k token e può peggiorare il turno. Serve precisione alta (riferimento policy: ≥85%, falsi ≤10%) senza spendere token per decidere, studiando come lo risolvono gli altri.

## Outcome atteso
- [x] Studio documentato: tecniche di altri (soglie a fasce, astensione, attivazione differita, secondo stadio, calibrazione) con fonti e cosa si applica, in `eval/skills-router/REPORT.md`. — prova: REPORT parte 4 (fonti sergiusavva, hussi9/skill-router, ToolPicker, SkillRouter; applicati 1-4, embedding non serve)
- [x] Router con astensione: attiva da solo solo ad alta confidenza; fascia media = solo suggerimento (chip), sotto = niente. — prova: `autoThreshold` 3 in `skills/router.json`, tier in `route()`; test «fasce» verde
- [x] Precisione delle attivazioni automatiche ≥ 85% su un holdout NUOVO (messaggi reali mai usati per la messa a punto), etichettato da un giudice indipendente (Opus), con intervallo di confidenza riportato. — prova: `node eval/skills-router/fresh.mjs`: 500 messaggi nuovi, auto 91/91 = 100% (IC95% 96–100%), giudice Opus; ma ~90% è git
- [x] Richiamo e tasso di attivazione riportati anche se bassi; nessun degrado su `cases.json`. — prova: richiamo auto 10%, auto+sugg. 16%; `run.mjs` richiamo 53% precisione 100% 0 falsi (calo richiamo accettato)
- [x] Costo token del router in decisione = 0 e latenza <5 ms per messaggio, misurati. — prova: fresh.mjs 0,038 ms/messaggio, nessuna chiamata al modello
- [x] Test unitari aggiornati (fasce, suggerimento, veto) e verdi; suite estensioni verde. — prova: `node --test extensions/*.test.ts`: 403 pass, 0 fail; 48 su skills/router/auto
- [x] Attivo di default (`PI_SKILLS=0` lo spegne) con `/skills` che mostra attivazioni e suggerimenti; test lo prova. — prova: `skills.ts` attivo salvo `PI_SKILLS=0`; test «solo suggerita» e storico `/skills`
- [x] A/B su compiti con skill di default vs senza, riportato anche se negativo. — prova: `ab.mjs` 2 giri: 16/16 pass in entrambi i bracci, costo +1,5% (2,744$ vs 2,702$), 3/8 compiti attivano
- [x] Intent `2026-11-13-skill-integrate-in-pi.md` e README/wiki aggiornati con lo stato. — prova: README, `vault/wiki/concepts/skill-router.md`, log wiki aggiornati

## Utenti e sistemi impattati
Utente di Pi (ogni turno di chat), `extensions/skills.ts`, `extensions/skills-router.ts`, `skills/router.json`, `eval/skills-router/`.

## Vincoli
- Token al primo posto; nessuna chiamata al modello per decidere; nessuna dipendenza nuova.
- Nessuna messa a punto sull'holdout; messaggi reali solo in `/tmp`.
- Nessun commit/push senza richiesta.

## Domande aperte
- Embedder locale come secondo stadio: solo se le regole non bastano.

## Verifica
```bash
node --test extensions/skills.test.ts extensions/skills-router.test.ts extensions/auto.test.ts
node eval/skills-router/run.mjs
node eval/skills-router/real.mjs
```
