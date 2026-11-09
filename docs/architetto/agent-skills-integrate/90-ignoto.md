# Ignoto
Aggiornato: 2026-11-09

| # | Domanda | Origine | Stato |
|---|---|---|---|
| 1 | Una skill con `disable-model-invocation: true` costa davvero zero nel prompt di Pi? | intervista | risolta in parte: nascoste raggiungibili col comando; costo zero da rimisurare |
| 2 | Pi carica `pi.skills` da un pacchetto installato con `install.sh`, o solo da `pi install`? | intervista | parziale: `pi.skills` da percorso locale funziona; da `pi install git:` non provato |
| 3 | Quali dei 9 comandi collidono? `/plan` è solo un esempio in Pi, non registrato da pi-claude; altri non cercati sul binario | intervista | parziale |
| 4 | Come si aggiorna una skill copiata senza perdere le note locali? | cosa non sto chiedendo | aperta |
| 5 | Le skill dipendono da `references/` condivise (issue #361): vanno copiate intere? | cosa non sto chiedendo | aperta |
| 6 | Le descrizioni delle skill sono in inglese: il tuo «resto in italiano» vale anche qui? | cosa non sto chiedendo | aperta |
| 7 | Il filtro `-` di `settings.json` si applica anche alle skill dei pacchetti? | territorio | risolta: il `-` di primo livello non filtra i pacchetti; serve la forma a oggetto |
| 8 | Pi sceglie quale skill, a parità di nome (collisione)? | territorio | risolta: vince la skill dell'utente, la copia del pacchetto sparisce senza avviso |
| 9 | In auto mode vale ancora «i tradeoff li decide l'utente» e «niente commit senza richiesta»? | auto mode | differita (studio auto mode) |
| 10 | `doubt-driven-development` come freno obbligatorio: costo in token e tempo per ogni decisione | auto mode | differita (studio auto mode) |
| 11 | Costo in token del prompt con le 25 skill nascoste e solo `using-agent-skills` visibile, da misurare | ricerca | aperta |
| 12 | `pi.skills` funziona con `pi install git:` (installazione sul PC dell'utente)? | ricerca | aperta |
| 13 | Skill integrate davvero: 14 di Addy + `loop-design-check` (ecc) in `skills/`, `pi.skills`, `skills/phases.json`, `scripts/sync-skills.mjs`, test 3/3; caricate da Pi (15 `skill:*`, origin package) | implementazione 2026-11-09 | risolta; costo prompt nascoste non rimisurato |
