# Ricerca: segreti usabili dalla chat di un agente

Data: 2026-11-18. Profilo rapido: una sola tornata di ricerca, nessuna fase repo/tradeoff formale. Fonti lette con `fetch_content` (README clonati) o snippet di ricerca (marcate).

## Principio comune
Il modello non vede mai il segreto: sta nel livello tool o nel livello rete, attaccato dopo che il modello ha deciso. Tutto ciò che sta nel contesto (prompt, messaggi, input e risultati dei tool) può riemergere (OWASP LLM07).
- AWS Secrets Manager, "Use secrets safely with AI Coding Agents": riferimenti dinamici risolti a runtime (snippet).
- Tracecat: il modello vede `${{ SECRETS.x.KEY }}`, il valore entra nel proxy server-side (snippet).
- Varlock proxy (letta): placeholder dall'aspetto valido nell'ambiente del figlio, sostituzione sulla connessione verso un host TLS verificato e legato con `@proxy(domain=…)`; risposte ripulite dal valore; audit log; segreti solo in memoria.

## Architetture trovate
1. **Segnaposto nel comando + sostituzione nel tool** (Tracecat, boxxkite). Semplice; richiede scrub dell'output e che il log di sessione conservi l'originale.
2. **Credential proxy di rete** (varlock, Postern per 1Password/Bitwarden). Il segreto non tocca nemmeno il processo; solo HTTPS, non copre sudo o ssh.
3. **Askpass con UI** (cc-askpass, letta; claude-sudo, letta; sudoplz, snippet). Il Bash tool non ha tty, quindi `sudo` fallisce. Soluzione: `SUDO_ASKPASS` + `sudo -A`, con un helper che chiede la password all'utente in un riquadro della UI (cc-askpass) o la legge dal keyring (claude-sudo). La password va dritta al programma, mai nel contesto né su riga di comando né su file. Il riquadro mostra il comando che girerà come root. Annullare non invia nulla. Un hook `PreToolUse` riscrive `sudo …` in `SUDO_ASKPASS=… sudo -A …`.
4. **Esecuzione con env iniettato** (`skv run -- cmd`, snippet): valori mai in argv né in repo.
5. **Archivio cifrato locale** (keeper, dsh-vault, skv, snippet): `node:crypto`, scrypt da passphrase, AES-256-GCM con il nome come AAD (un blob non si sposta tra nomi), fallimento chiuso se corrotto, chiave in cache nel processo dopo lo sblocco. Alternativa: `age` in modalità scrypt (sympa). Gerarchie a più livelli (Infisical, Vault) servono solo per i server.

## Cosa cambia nel nostro piano
- **sudo**: non `sudo -S` con la password nel comando, ma askpass. Un helper piccolo (script) che chiede a Pi via canale locale (socket Unix / pipe con nome in `/tmp`, permessi 600) la password; Pi la prende dall'archivio o apre il dialog. Mostrare all'utente il comando che girerà come root, conferma ogni volta o finestra scorrevole breve.
- **Mascheramento in input**: cc-askpass ha il problema dei tasti che finiscono nel prompt prima della chat. Per noi vale la strada del campo mascherato nel prototipo.
- **Login sito**: legare il segreto all'host (come `@proxy(domain)`) e iniettare solo se l'host del comando corrisponde.
- **Scrub**: oscurare i valori nell'output dei tool (varlock lo fa sulle risposte).
- **Audit log** con nome, comando e ora, senza valori.

## Non coperto / da verificare
- `unknown`: se Pi registra nella sessione il comando bash originale con `{{secret:x}}` o quello sostituito da `tool_call`. Test da fare.
- `unknown`: sudo askpass funziona sotto WSL e macOS senza tty; Windows non ha sudo.
- `unknown`: i valori già nel contesto (utente incolla la password in chat) non si possono ritirare: serve avviso e rilevamento.
- Limite noto: una sostituzione nel comando non protegge se il modello scrive `echo {{secret:x}}`; lo scrub dell'output attenua, non chiude (il modello può codificare il valore). Serve conferma per comandi che stampano o inviano il valore.

## Esito test log di sessione (2026-11-18)
Estensione di prova: `tool_call` sostituisce `{{secret:x}}` in `event.input.command`; `pi -p --model haiku` con `echo {{secret:x}}`, sessione in `--session-dir` dedicata.
- Il `toolCall` salvato nel jsonl ha il comando **originale** (segnaposto): la mutazione in place non entra nel log né nel contesto del modello.
- Il valore reale compare **solo nel risultato del tool** (e nella risposta che lo ripete): lo scrub in `tool_result` è obbligatorio, non opzionale. Con `echo` il valore è arrivato al modello.
- Chiude l'unknown «originale o sostituito»: vale l'originale. Resta la regola: confermare/bloccare comandi che stampano il segreto.
