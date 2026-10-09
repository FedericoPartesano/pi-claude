# Pi Desk (MVP)

Pi in una finestra: le sessioni a sinistra, la chat al centro, a destra un pannello a schede (immagini, codice, documenti,
PDF, il browser che Pi pilota con `pi-browser`) che compare solo quando apri qualcosa. Il disegno segue l'handoff
"Pi TUI Redesign" (desktop): stessi stati e colori del terminale.

```bash
cd pi-desk && npm install
npm start                      # Pi lavora nella cartella corrente
npm start -- ~/progetti/shop   # oppure in un'altra
```

- **Pi è lo stesso del terminale.** `pi --mode rpc` gira come processo figlio, con le stesse estensioni, la stessa memoria,
  le guardie e i goal. L'app è solo un'interfaccia: per tornare al terminale basta chiuderla.
- **Una barra di stato sopra il campo di scrittura** dice sempre cosa succede, con un colore per stato: AL LAVORO (con
  il passo e i secondi, `esc` interrompe), TOCCA A TE (S sì · A sempre · N no), FERMO (R riprova), FATTO (1–4 per i
  suggerimenti).
- **Il turno è una lista di passi** in parole ("Modifico cart.js", "Eseguo i test"), piegata a turno finito tranne gli
  errori; sotto, la risposta, le immagini prodotte, i file modificati (Rivedi apre il codice con le righe cambiate) e i
  suggerimenti. I turni precedenti sono una riga ciascuno.
- **Il browser a destra è una vista di Electron** esposta su una porta di debug locale (`127.0.0.1:9339`,
  `PI_DESK_CDP_PORT` per cambiarla). Pi la pilota con il tool `browser` (`PI_BROWSER_CDP`); la pagina della chat è esclusa
  (`PI_BROWSER_SKIP`). Puoi navigare anche tu dalla barra dell'indirizzo.
- **Le conferme di Pi stanno nel turno.** Un sito nuovo da aprire, un comando pericoloso: la domanda compare sotto il
  passo in corso, con i bottoni e i tasti del terminale. Vale anche per i Pi aperti nei terminali (`desk-link`).
- `PI_DESK_PI` indica un altro comando `pi`. Se il tuo Pi non carica già questo repo come pacchetto, `pi-browser` viene
  aggiunto con `-e`.

- **Sessioni** (☰ o Ctrl+B; si chiude da sola sotto 1000 px): tutte le sessioni di Pi su questo PC, filtrabili per
  progetto, con ricerca (Ctrl+K). Prima quelle che **richiedono te** (un Pi in attesa di un permesso, o fermo), poi
  questa, quelle in corso e le recenti. In fondo l'uso dell'abbonamento (5H, 7G) e il contesto (CTX).
  - **In corso** (● pid): i Pi aperti adesso nei terminali, riconosciuti da `/proc` su Linux e WSL. Si aggiornano mentre
    l'altro Pi lavora, e **ci puoi scrivere**: il messaggio arriva a quel Pi tramite `desk-link`, un socket locale privato
    (`~/.pi/agent/desk/<pid>.sock`). Lì compare come scritto da te, e va in coda se Pi sta lavorando. Il file della
    sessione non viene mai toccato da qui. I Pi avviati prima dell'aggiornamento restano in sola lettura finché non li
    riavvii.
  - **Chiuse:** si leggono e, con "Riprendi qui", Pi riparte nella loro cartella con quella sessione (`--session`).
  - **＋ Nuova** (Ctrl+N): riparte con una sessione nuova. **dirama** sotto una risposta crea una sessione nuova da quel
    messaggio.
- **Agisci / Piano / Chiedi** sotto il campo: Piano chiede a Pi un piano prima di agire, Chiedi solo risposte (una riga
  premessa al messaggio, solo quando li scegli).

Limiti dell'MVP:
- le sessioni in corso si riconoscono solo su Linux e WSL; su macOS e Windows compaiono ma senza il badge;
- goal, loop e team si vedono come chip nell'intestazione, senza pannelli dedicati;
- "Annulla turno" del disegno non c'è: Pi non tiene una copia dei file di inizio turno.
- il pannello a destra ha larghezza fissa (52%, al massimo 640 px; 48% e 760 px sopra i 1500 px).

## Sviluppo

L'interfaccia è in **Solid** (`renderer/`, build con Vite in `ui-dist/`), con:
- font IBM Plex Sans e JetBrains Mono inclusi (`@fontsource`, niente rete);
- Kobalte per le sezioni richiudibili;
- icone Lucide;
- lista delle sessioni virtualizzata (TanStack Virtual);
- `@solid-primitives` per ridimensionamento e salvataggio locale.

Il Markdown, i grafici e i suggerimenti li rende `renderer/src/render.ts`, a blocchi in cache: durante lo streaming
si ridisegna solo il blocco che cambia.

```bash
npm start        # build dell'interfaccia + Electron
npm run dev      # build continua mentre modifichi renderer/ (poi Ctrl+R nella finestra)
npm test         # build + test: rendering, client RPC, sessioni, desk-link, interfaccia in Chrome headless
```
