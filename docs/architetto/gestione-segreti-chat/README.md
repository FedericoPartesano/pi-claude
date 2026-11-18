# Gestione segreti dalla chat
Aggiornato: 2026-11-18 · fase 6 · profilo: rapido (brief, territorio, repo e tradeoff formali saltati)

Estensione di Pi per variabili, login di siti (url + utente + password) e password sudo, usabili dalla chat senza che il modello veda i valori.

## Decisione
[ADR 0002](../../adr/0002-segreti-nella-chat-segnaposto-e-askpass.md), stato `accepted`: archivio cifrato locale, segnaposto `{{secret:nome}}` sostituito in `tool_call`, scrub in `tool_result`, askpass per sudo, campo mascherato nel prototipo.

## Falsificatore
Batteria di 20 comandi ostili: se uno fa arrivare il valore al modello o al log senza blocco né conferma, si passa a proxy di rete o `bwrap`.

## File
- `10-ricerca.md`: architetture trovate (AWS, Tracecat, varlock, cc-askpass, claude-sudo, skv, keeper) ed esito del test sul log.

## Spesa
1 tornata di ricerca (4 query, 4 README letti), 1 test eseguito, 0 subagenti, 0 repo profilati.

## Ignoto
- `da verificare in implementazione`: askpass su WSL e macOS, con `bash scripts` di prova.
- `da verificare in implementazione`: campo mascherato in RPC; batteria ostile; test del log con un secondo modello.
- Differito: keyring di sistema e proxy di rete.

## Implementazione e prove (2026-11-18)
Codice: `extensions/secrets.ts` + `extensions/secrets/` (`store`, `guard`, `askpass`, `fields`, `cli`). Registrata in `package.json`. Spegnimento: `PI_SECRETS=off`.
- Uso: `/secret add NOME [var|login|sudo]`, `list`, `rm NOME`, `lock`; da shell `pi secret add|list|rm`. Nei comandi: `{{secret:nome}}`, login `.user/.password/.url`. File: `~/.pi/secrets.enc` (`PI_SECRETS_FILE`), audit `~/.pi/secrets-audit.log`, passphrase non interattiva `PI_SECRETS_PASSPHRASE`.
- Inserimento: nella chat prototipo i titoli con 🔒 sono mascherati (`•••`); nel Pi classico `ctx.ui.input` mostra in chiaro, quindi lì usare `pi secret add`.
- Costo: una riga di prompt (~40 token) solo se esistono segreti; nessun timer; askpass avviato al primo `sudo`.

Prove empiriche (Pi reale, haiku e sonnet, server HTTP locale con Basic auth, `sudo` finto che passa dall'askpass):
- login iniettato: `AUTH-OK`; `echo {{secret:tok}}` bloccato; il server che rimanda il token indietro → nel risultato `[secret:tok]` (scrub).
- sudo: conferma mostra il comando, `ROOT-OK` con password giusta; rifiuto → nessun invio, comando bloccato.
- nessun valore in `.jsonl` di sessione, audit e `secrets.enc` (grep sui valori: nessun file).
- batteria ostile `extensions/secrets/guard.test.ts`: 34 comandi (echo, base64, heredoc, interpreti, `env`/`set`, curl a host non legato o con `--resolve`/`-x`, `sudo -S`, lettura di `secrets.enc`): nessuno passa senza blocco o conferma. Falsificatore dell'ADR non scattato.
- Suite: 445/445 verdi; `pi-claude-code` tsc pulito.

Limiti noti: euristica, non un confine (codifiche non previste, script scritti dal modello con conferma data distrattamente); password incollata in chat non ritirabile; sudo reale con password non provato (solo `sudo` finto, qui non ho la password); macOS non provato; Windows senza sudo.

### Tool `secret` (2026-11-18)
Su richiesta dell'utente il modello ha un tool esplicito, non solo il segnaposto in bash: `secret {action: list | run, command?}`. `list` dà nomi, tipo e host legato (mai valori); `run` esegue il comando con i segnaposto sostituiti, `sudo …` con la password salvata dopo conferma, output ripulito. Il tool è spento (`defaultActive: false`) e si accende da `before_agent_start` solo se esiste almeno un segreto: costo zero senza segreti. La riga di prompt (~50 token) dice al modello che esiste. Le chiamate parallele condividono una sola richiesta di passphrase. Prova: Pi reale, `list` → `local (login) → http://127.0.0.1:8099 / sudo (sudo) / tok (var)`; `run` curl col login → `AUTH-OK`; `run sudo true` con conferma → `ROOT-OK`; nessun valore in sessione e audit. Test: `extensions/secrets.test.ts` (3), suite segreti 18/18.

### Scheda nella chat (2026-11-18)
Nel prototipo (`chat.mjs`, `isSecretStep`/`secretLabel`) i passi del tool `secret` e dei bash con `{{secret:…}}` hanno una scheda a parte: barra magenta, `◆`, nomi dei segreti usati, «· root» se c'è sudo, comando con i segnaposto come `‹nome›`; `⊘ bloccato` in giallo se negato o fermato. Visto nel pty (ctrl+o apre i passi). Nessun lavoro per frame in più (stesso `stepRow`, righe chiuse in cache).
