---
status: done
---
# Auto con Paperclip e pi-team

## Outcome atteso
- [x] `/auto` funziona come agente Paperclip (adattatore `process`): heartbeat con identità, inbox, checkout atomico (409 mai ritentato), lavoro, stato + commento — prova: `extensions/auto-paperclip.test.ts` (12 test verdi, Paperclip finto); comando lanciato a mano contro un server finto: `{"outcome":"nessun-lavoro"}`, exit 0.
- [x] I passi build che falliscono due volte di fila vanno a pi-team (implementatore + revisore, check congelato come verifica, stesse protezioni di un figlio di auto) — prova: `teamStep` testato con agenti finti: worker caricato, `PI_AUTO_PHASE=build`, verifica via check del supervisore; loop passa `requirement.failures` 0,1,2.
- [x] Nessuna regressione — prova: `extensions/*.test.ts` 417 verdi, `pi-team/test` 100 verdi, `npx tsc -p .` in pi-team pulito.
- [x] Prova con Paperclip vero e con un modello vero (un task piccolo) — prova: Paperclip nightly 2026.1113.0, agente `process` pi-auto, task TES-1 (total() sottraeva): branch auto/pc-tes-1 con il fix `a + b` (commit 8b2d8c9), run 5c577503 `succeeded`, issue `in_review` con interazione request_confirmation pending. Bug trovati e corretti: `command`/`args` separati nella config; `in_review` richiede un percorso di revisione (422), e assegnare un umano cancella il run ("cancelled before issue reassignment"), quindi si apre una request_confirmation. Un run non riuscito ha lasciato 3 commit duplicati `docs(auto): esito` nel branch (ritentati da Paperclip).
