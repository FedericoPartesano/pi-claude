# Auto mode: misure

## 2026-11-09 · costo di un passo (fase 4 dello studio `docs/architetto/auto-mode/`)
Modello haiku, provider `claude-code`, WSL. Turno «rispondi solo: ok», `pi --mode json -p --no-session`.

| Configurazione | Token di prefisso per turno | Tempo totale |
|---|---|---|
| Sessione completa dell'utente (tutte le estensioni, skill, CLAUDE.md) | 23 906 (2 902 cacheWrite + 21 004 cacheRead al primo giro; 23 906 cacheRead al secondo) | 8,6 s; 6,8 s |
| Figlio `--no-extensions -e pi-claude-code --no-skills --tools read,bash,edit,write` | 4 554 (cacheWrite al primo giro, cacheRead dopo) | 4,4 s; 4,4 s; 6,6 s |
| Figlio + estensione con un comando e due hook | 4 554 | — |

Lettura: il prefisso del figlio è il 19% di quello della sessione completa; comandi e hook non costano token. I tempi includono l'avvio di Pi e di `claude -p`.

Limiti:
- solo 2–3 giri per configurazione, su una macchina sola;
- il turno è minimo, quindi il costo di un passo vero (letture, edit, test) non è misurato;
- il costo di un goal intero si misura sul banco.

## 2026-11-10 — prima corsa reale con haiku (documenti di progetto)

Repo di prova vuoto (`README.md` + `package.json`), goal «aggiungi un comando add che salva una voce in spesa.json e un comando list che le stampa», `claude-code/haiku`, sandbox bwrap, WSL.

- Esito: `completato`, 12/12 requisiti verdi, 10 passi in 20 min (13:49→14:09 UTC); `node --test` nel worktree 25/25; `add`/`list` provati a mano.
- Documenti: i 6 scritti in un passo (prd, trd, flusso, design, schema, piano; 10,3 KB in tutto), concreti e coerenti col goal; 11 scelte in `auto/da-approvare.md`, ognuna con l'alternativa scartata.
- Costo: finestra 5h da 4% a 8% (+4 punti, 0,4 punti per passo, sotto il 6% del falsificatore dell'ADR 0001); 3.175.661 token contati (quasi tutti letture di cache).
- Difetto trovato: nel passo dei documenti haiku ha lanciato `find / … -name progetto`, che su WSL percorre `/mnt/c` e non finisce; il passo è rimasto fermo ~9 min finché il `find` è stato ucciso a mano. Correzioni: timeout predefinito di 300 s ai comandi bash del figlio (`PI_AUTO_BASH_SECONDS`), prompt che vieta ricerche fuori dal worktree e dice di creare la cartella dei documenti. Non ancora riprovate con una corsa reale.

## 2026-11-10 — passo build reale con browser e lancia (haiku)

Un solo passo build lanciato con `runChild` in un repo di prova (`README.md` + `package.json`). Requisito: `server.js` sulla porta 8080 serve `public/index.html` con un form che aggiunge voci alla lista. Modello `claude-code/haiku`, sandbox bwrap, WSL2 (browser = Electron di terminal-browser senza finestra).

- Strumenti accesi dal codice: `browser` + `lancia` (dati e usati); skill intere `incremental-implementation` e `frontend-ui-engineering`, nessuna letta dalla lista.
- Lavoro: `server.js`, `public/index.html`, `test/server.test.js` (2 test verdi); server avviato con `lancia`; nel browser scritto «Latte», premuto Aggiungi, verificato con `eval` che la voce è nella lista e il campo è vuoto; console senza errori; screenshot. Due commit.
- Costo: 436 768 token (input + cache + output), 499 s in totale.
- Problemi trovati e corretti:
  - `find /` di nuovo (300 s persi fino al timeout di bash): ora bloccato dalla policy (`/`, `~`, `$HOME`, `/home`, `/usr`, `/mnt[/x]`).
  - falso positivo «privilegi di root»: la parola italiana «su» in un heredoc; ora sudo/su/doas/pkexec contano solo in posizione di comando.
  - falso positivo «scrittura fuori dal worktree» su `cp ~/.cache/…/shot.png auto/`: per cp/ln/install conta solo la destinazione.
  - dopo `agent_settled` Pi è rimasto vivo con l'Electron figlio fino all'arresto manuale (in 3 riproduzioni brevi esce in 6–8 s, causa non trovata): il supervisore chiude il gruppo 15 s dopo `agent_settled` (`PI_AUTO_SETTLE_MS`) e conta il passo come riuscito.
- Artefatto della prova, non del codice: il repo non aveva `intents/` né `auto/requisiti.json`, e il modello ha speso alcuni turni a cercarli.
