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

Limiti dell'MVP:
- niente cronologia delle sessioni;
- niente immagini incollate;
- niente pannelli per memoria, goal e team;
- la divisione tra chat e browser è fissa (42% / 58%).

Test: `npm test` (client RPC con un `pi` finto).
