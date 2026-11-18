---
status: accepted
---
# Segreti nella chat: archivio cifrato, segnaposto nel tool, askpass per sudo

Pi gestisce variabili, login di siti e password sudo senza che il valore entri nel contesto del modello. I segreti stanno in `~/.pi/secrets.enc` (scrypt + AES-256-GCM, `node:crypto`). Il modello scrive `{{secret:nome}}` nei comandi bash; l'estensione `extensions/secrets.ts` lo sostituisce in `tool_call` e toglie i valori da `tool_result`. Per sudo si usa `SUDO_ASKPASS` con `sudo -A`, non `sudo -S`. Il motivo: il valore non deve mai passare dal modello, dal log di sessione o da una riga di comando.

## Osservazione → spiegazione → scelta e conseguenza
- **Osservazione.**
  - Con una sostituzione in `tool_call` il log di sessione conserva il comando originale col segnaposto (test 2026-11-18, haiku, `--session-dir` dedicata).
  - Il valore reale compare solo nel risultato del tool, e con `echo` il modello lo ha ripetuto in chat.
  - Il Bash tool non ha un terminale: `sudo` senza askpass fallisce (cc-askpass, claude-sudo).
  - `ctx.ui.input` di Pi mostra in chiaro ciò che si digita, e le estensioni non importano `pi-tui`.
- **Spiegazione.** Il livello tool è l'unico punto dove il valore esiste senza essere nel contesto. L'uscita del comando però rientra nel contesto, quindi va ripulita.
- **Scelta e conseguenze.**
  - Archivio: un file cifrato con passphrase master; il nome del segreto è dato autenticato (AAD), così un blob non si sposta tra nomi; se il file è corrotto si fallisce chiusi. Chiave in cache nel processo dopo lo sblocco. Permessi 600.
  - Tipi: variabile (nome → valore), login (url + utente + password, iniettato solo se l'host del comando corrisponde), sudo.
  - Scrub obbligatorio dei valori in `tool_result`. I comandi che stampano o inviano il segreto (`echo`, `cat`, `env`, `curl` verso host non legato) sono bloccati o chiedono conferma.
  - Sudo: l'helper askpass chiede la password a Pi su un canale locale con permessi 600. Prima di eseguire, Pi mostra il comando che girerà come root e chiede conferma. Annullare non invia nulla.
  - Inserimento: campo mascherato nel prototipo `rpc-chat`; in Pi classico `pi secret add` da shell con echo spento, mai `ctx.ui.input` in chiaro.
  - Audit log con nome, comando e ora, senza valori.
  - Prompt fisso: una riga di circa 30 token, solo se esistono segreti (mantra dei token).

## Obiezione più forte e falsificatore
- **Obiezione.** Lo scrub non ferma un modello che codifica il valore (base64, spezzato) o lo scrive in un file; sotto prompt injection un comando ben formato può esfiltrarlo. Una password incollata in chat resta nel contesto e non si ritira. La sicurezza è euristica, non un confine (come `protected-paths.ts`).
- **Falsificatore.** La scelta è sbagliata se, in una batteria di almeno 20 comandi ostili (`echo`, `base64`, `printf` spezzato, `curl` verso un host non legato, scrittura su file, `env`), uno solo fa arrivare il valore in chiaro al modello o al log senza blocco né conferma. In quel caso serve un proxy di rete o l'esecuzione in `bwrap` come varlock.

## Alternative scartate
- **Segnaposto puro, senza askpass**: sudo -S metterebbe la password nel comando; il Bash tool non ha tty.
- **Keyring di sistema** (libsecret, Keychain, Credential Manager): più sicuro, ma diverso per piattaforma e fragile su WSL; resta come evoluzione, con la stessa interfaccia dell'archivio.
- **Proxy di credenziali di rete** (varlock, Postern): il valore non tocca il processo, ma copre solo HTTPS e non sudo né ssh. Rimandato come difesa in profondità.
- **Valore leggibile dal modello**: scartato, finisce nel contesto e nei log.

## Cosa non sappiamo ancora
- Se `SUDO_ASKPASS` con `sudo -A` funziona sotto WSL e macOS senza tty. Windows non ha sudo.
- Come far parlare il campo mascherato in RPC e nel prototipo senza far costare token o CPU (budget ≤ 1/4 di Pi).
- Se Pi in modalità RPC e `print` supporta un dialog password senza che i tasti passino dal prompt.
- Il tasso di fuga sulla batteria di 20 comandi ostili.
- Il test sul log vale per `haiku` e un solo giro: va ripetuto con un altro modello.
