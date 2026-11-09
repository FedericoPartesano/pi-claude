# Mappa del territorio: skill di terzi in un pacchetto Pi
Aggiornato: 2026-11-09 · fase 1b · fonti: `docs/skills.md` e `docs/packages.md` di Pi (letti), README e `contents/skills` del repo di Addy (letti con `gh`), `~/.pi/agent/settings.json` (letto). Il resto è conoscenza dell'assistente, non verificata.

## Concetti
- Skill = cartella con `SKILL.md` (`name`, `description`) più `references/`, `scripts/`, `assets/` opzionali. `coperta`
- Caricamento progressivo: nel prompt solo nome, descrizione e percorso; le istruzioni si leggono a richiesta (docs Pi). `coperta`
- `disable-model-invocation: true`: la skill è raggiungibile solo col comando esplicito (docs Pi). Se costi zero nel prompt: da misurare. `coperta`
- Filtro per utente: `settings.json` → `skills` con prefisso `-` disattiva una skill. Oggi 34 voci. Una skill del pacchetto può essere spenta da qui. `non coperta`
- Percorso fisso dei riferimenti: le skill citano `references/` condivisa a livello di repo (issue #361 di Addy). `non coperta`

## Pattern
- Pacchetto Pi con `"skills": ["./percorso"]` in `package.json`. `coperta`
- Copia nel repo con attribuzione e script di sincronizzazione. `coperta`
- Installazione via CLI esterna `npx skills add` (70+ agenti). `non coperta` (alternativa, non scelta)
- Prefisso di nome per evitare collisioni. `coperta`

## Trade-off
- Copia fissa contro upstream vivo. `coperta`
- Visibilità automatica contro costo di prompt. `coperta`
- Fedeltà al testo originale contro adattamento a Pi. `coperta`

## Modi di fallimento
- Collisione di nome con skill utente: Pi può scegliere una a caso o ignorare una delle due. `non coperta`
- `/plan` esiste già come comando di esempio in Pi (`examples/extensions/plan-mode`); non risulta registrato da pi-claude, ma altre estensioni installate potrebbero registrarlo. `non coperta`
- Skill che invocano strumenti assenti in Pi (subagenti, DevTools MCP, plugin). `coperta`
- Aggiornamento upstream che rompe le note locali. `coperta`
- Skill di terzi che istruiscono il modello a eseguire comandi: rischio di sicurezza (docs Pi). `non coperta`

## Attributi di qualità
- Efficienza (token): coperta. Portabilità: coperta. Manutenibilità: coperta. Sicurezza (contenuto di terzi): non coperta. Compatibilità con skill esistenti: coperta.

## Non coperte → decisione di Federico
1. **Filtro `-` in `settings.json`:** oggi 34 skill tue sono disattivate così. Proposta: le skill di Addy restano attive di default (solo l'indice visibile), e un ulteriore filtro le spegne se vuoi. Affrontare.
2. **Collisione di nomi:** prefisso `ads-` anche per le skill non duplicate? Proposta: solo per le 5 doppie, e un test che fallisce se un nome collide. Affrontare.
3. **Comando `/plan`:** collisione possibile. Proposta: tutti i comandi con prefisso `as:` (già deciso in Q4a). Coperta dalla decisione.
4. **Sicurezza:** revisione una tantum dei `scripts/` e dei comandi nelle skill prima di copiarle. Proposta: affrontare in fase 2 con un controllo automatico (grep di `curl`, `rm`, `eval`, `sudo`).
5. **`references/` condivisa:** copiarla intera in `skills/agent-skills/references/`. Proposta: affrontare.
