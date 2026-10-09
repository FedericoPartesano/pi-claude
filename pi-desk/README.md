# Pi Desk (MVP)

Pi in una finestra: la chat a sinistra, un browser a destra che Pi pilota con `pi-browser`.

```bash
cd pi-desk && npm install
npm start                      # Pi lavora nella cartella corrente
npm start -- ~/progetti/shop   # oppure in un'altra
```

- **Pi è lo stesso del terminale.** `pi --mode rpc` gira come processo figlio, con le stesse estensioni, la stessa memoria,
  le guardie e i goal. L'app è solo un'interfaccia: per tornare al terminale basta chiuderla.
- **Il browser a destra è una vista di Electron** esposta su una porta di debug locale (`127.0.0.1:9339`,
  `PI_DESK_CDP_PORT` per cambiarla). Pi la pilota con il tool `browser` (`PI_BROWSER_CDP`); la pagina della chat è esclusa
  (`PI_BROWSER_SKIP`). Puoi navigare anche tu dalla barra dell'indirizzo.
- **Conferme di Pi come dialoghi.** Un sito nuovo da aprire, un comando pericoloso: i dialoghi delle estensioni arrivano
  via RPC.
- `PI_DESK_PI` indica un altro comando `pi`. Se il tuo Pi non carica già questo repo come pacchetto, `pi-browser` viene
  aggiunto con `-e`.

- **Sessioni** (☰ in alto): tutte le sessioni di Pi su questo PC, per progetto, con ricerca.
  - **In corso** (● pid): i Pi aperti adesso nei terminali, riconosciuti da `/proc` su Linux e WSL. Si aggiornano mentre
    l'altro Pi lavora, e **ci puoi scrivere**: il messaggio arriva a quel Pi tramite `desk-link`, un socket locale privato
    (`~/.pi/agent/desk/<pid>.sock`). Lì compare come scritto da te, e va in coda se Pi sta lavorando. Il file della
    sessione non viene mai toccato da qui. I Pi avviati prima dell'aggiornamento restano in sola lettura finché non li
    riavvii.
  - **Chiuse:** si leggono e, con "Riprendi qui", Pi riparte nella loro cartella con quella sessione (`--session`).
  - **＋ Nuova:** riparte con una sessione nuova.

Limiti dell'MVP:
- le sessioni in corso si riconoscono solo su Linux e WSL; su macOS e Windows compaiono ma senza il badge;
- niente immagini incollate;
- niente pannelli per memoria, goal e team;
- la divisione tra chat e browser è fissa (42% / 58%).

## Sviluppo

L'interfaccia è in **Solid** (`renderer/`, build con Vite in `ui-dist/`), con:
- Kobalte per dialog e sezioni richiudibili;
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
