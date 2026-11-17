---
status: ready
created: 2026-11-13
source: user
---

# Skill agent-skills integrate in Pi: attivazione automatica e UI dedicata

## Problema
Le skill in `~/.agents/skills/` si usano solo a mano (`/skill:nome`) o dentro `/auto`, dove `extensions/auto/skills.ts` le sceglie per fase da `skills/phases.json`. Nella chat normale l'utente deve ricordarsi che esistono. Il modello può caricarle, ma ogni skill elencata nel prompt costa token fissi (già ridotti da 30 a 7 con `disable-model-invocation`). Non si vede quando una skill parte, perché, né cosa costa.

## Decisioni (dal colloquio del 2026-11-13)
- Attivazione: router nel codice, non il modello. Costo ≈ 0 token finché non scatta; inietta solo il `SKILL.md` scelto.
- Segnali: testo del messaggio, comando in corso (slash, `/auto`, `/goal`, `/loop`), contesto repo (diff, test rossi, file toccati), cronologia della sessione (niente riattivazioni della stessa skill nel turno).
- UI: chip nella barra di stato + pannello skill.
- Dove: Pi reale, nuova estensione in `extensions/` + integrazione in `pi-ui`.
- Riuso: estrarre da `extensions/auto/skills.ts` il nucleo (contratto `phases.json`, trigger regex) in un modulo condiviso; `/auto` continua a funzionare uguale.

## Outcome atteso
- [x] Router `extensions/skills-router.ts`: dato messaggio + comando + contesto repo + storia, restituisce 0..N skill con motivo e confidenza; deterministico, senza chiamate al modello, ≤ 5 ms a messaggio. Soglia sotto cui non scatta niente. — prova: `node --test extensions/skills-router.test.ts` 10/10 verdi (segnali, soglia, storia, override, tetto, ≪5 ms); regole in `skills/router.json`
- [ ] (in corso: `extensions/skills.ts` inietta il SKILL.md in un messaggio nascosto solo se il router scatta, tetto 2, registrata in package.json; `skills.test.ts` 6/6 verdi; manca la misura del prompt fisso prima/dopo e il formato «le altre come percorso») Iniezione: solo il testo della skill scelta, al massimo `maxInline` per turno (stesso tetto di auto mode), le altre come percorso + «quando usarla». Prompt fisso invariato (misurato prima/dopo).
- [ ] Nucleo condiviso con `extensions/auto/skills.ts` senza regressioni (`auto.test.ts` verde).
- [ ] (in corso: `/skills`, `off|on [nome]`, `reset` fatti e testati; manca il pannello e "non riattivare" persistente) Controlli: `/skills` (pannello), on/off globale e per skill, «non riattivare in questa sessione», rispetto di `disable-model-invocation` e di `/skill:nome` esplicito (che vince sempre).
- [x] Chip nella barra di stato di `pi-ui`: nome skill attiva e fase, sparisce a fine turno; nessun lavoro per frame, nessun timer. — prova: `node eval/skills-router/ui.mjs` (chip «SKILL nome», sparisce a fine turno), `pi-ui/test/footer.test.ts` verde
- [x] Pannello skill: elenco con stato, storico attivazioni (quando, motivo, segnale, token iniettati), tasti per disattivare. Grafica «Neon Night» sobria. — prova: sezione SKILL in `pi-ui/src/panel.ts` (attive/suggerite, storico con motivo e token, spente, `/skills off|on`), test a 30/40/60 colonne in `panel.test.ts`; i tasti per disattivare restano i comandi `/skills`
- [x] Riga compatta nel flusso quando una skill scatta («skill: nome — motivo»), espandibile; niente toast. — prova: `skillLine` + renderer `skill-activation` in `extensions/skills.ts`, test «la riga nel flusso è compatta…» verde (una riga per skill, segnali solo se espansa, larghezza 30); suite estensioni 405 verdi. Non visto nel TUI reale
- [ ] Test: router (ogni segnale, soglia, no-doppia-attivazione, override esplicito), iniezione, chip, pannello (larghezze strette); tsc pulito; suite estensioni verde.
- [x] Qualità del router misurata su un set etichettato di ≥40 messaggi/contesti (attiva la skill giusta / non attiva quando non serve), precisione e richiamo in `eval/skills-router/REPORT.md` anche se negativi. — prova: `eval/skills-router/REPORT.md`, 45 casi: richiamo 90%, precisione 93%, 0 falsi su 15 neutri (limite: set scritto da me); su 3785 messaggi reali precisione 38-55%, A/B 8 compiti: stessa correttezza, costo +15% — vedi parte 2 del report; v2 con cornice di richiesta e veto: precisione holdout 45% → 63% su 603 messaggi etichettati da Opus (parte 3)
- [ ] Prestazioni: costo in token per turno e CPU di `pi-ui` con chip e pannello, prima/dopo, in `eval/ui/REPORT.md` anche se negativo; degrado importante = non si accetta.
- [ ] Prova d'uso dell'utente nel TUI reale: un messaggio «c'è un bug in X» fa partire la skill giusta, il chip si vede, il pannello spiega perché.
- [ ] README e wiki (`vault/wiki/`) aggiornati.

## Fuori da questo lotto
Apprendimento dall'uso (pesi dai feedback), skill generate dal modello, installazione di skill da repo, toast, supporto nel prototipo `rpc-chat`.

## Vincoli
- Token al primo posto: prompt fisso corto e stabile per la cache; il router non spende prompt per decidere.
- Nessuna dipendenza nuova; niente lavoro per frame; embedder locale solo se le regole non bastano, e misurato.
- Nomi dei comandi in inglese.
- Estensioni importate da altre col percorso reale (niente symlink).
- Nessun commit/push senza richiesta esplicita.
- Commenti nel codice in inglese, UI in italiano.
