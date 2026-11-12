---
stato: bozza
---
# Flusso — pi-claude

Prodotto a riga di comando: nessuna app web, le «schermate» sono viste del terminale.

## Chat (`pi`, prototipo `chat.mjs`)
- Testo + invio: prompt; durante il lavoro è `steer` (in coda, «↳ in coda»). ctrl+c: abort; a riposo esce. ctrl+d esce.
- `/comando` e `@file` con completamento; tasti 1-4 a prompt vuoto = suggerimenti; ctrl+t pensiero; alt+s pannello; alt+d / ctrl+enter `/now`; alt+v incolla immagine.
- Comandi principali: `/model`, `/resume`, `/new`, `/name`, `/compact`, `/img`, `/goal`, `/loop`, `/intent`, `/dream`, `/ricorda`, `/archive`, `/bugreport`, `/title`.

## `/auto <goal>` e controllo
`/auto <goal>` avvia la corsa; `/auto status`, `stop`, `resume [slug]`, `pausa`, `riprendi`, `nota <testo>`. Fasi: intent → define → plan → build → verifica → review → consegna. Azioni irreversibili finiscono in `auto/da-approvare.md`.

## Cockpit (`alt+a` o `/auto` senza argomenti)
- Testata: fase, passo, salute (PROCEDE, A RISCHIO, FERMA, SERVE TE) con motivo, tempo, «fermo da Ns».
- Elenco requisiti con `n/m`; passo corrente in diretta (ultimi tool, testo finale).
- Modi: IN DIRETTA; ←/→ entra in RIVEDI (passo «k di n», esito, durata, token); esc o → oltre l'ultimo torna IN DIRETTA.
- Tasti: `p` pausa/riprendi, `:` nota al prossimo passo, `s` stop, `q` chiude. Riga dei tasti contestuale, «in attesa: …» finché il comando non è applicato.
- Stati anomali: nessuna corsa, corsa finita, diario assente/troncato, stato illeggibile → messaggio italiano col prossimo tasto utile.
- Resize: ridisegno differenziale; sotto 70 colonne i blocchi si impilano.
