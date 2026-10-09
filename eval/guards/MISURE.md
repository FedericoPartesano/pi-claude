# Guardie, /goal --metric, /land: misure

Riproducibili dalla radice (WSL2, Node 24). Prima = `main` a 7e91820, dopo = questo branch.

## Costo in token (`tokens.mjs`)

`node eval/guards/tokens.mjs <radice-prima> <radice-dopo> 3`. Tutte le estensioni del pacchetto, stesso prompt con un tool
(read), 3 giri alternati, abbonamento (mai `--bare`).

| | Prima richiesta | Totale (2 richieste) |
|---|---|---|
| prima | 5218 | 10509 |
| dopo | **5218** | **10509** |

Identici in tutti e 6 i giri: guardie e `/land` non aggiungono tool né testo al prompt; `/goal --metric` solo mentre un goal
con metrica è attivo. Le guardie parlano al modello solo quando trovano qualcosa.

## Falsi allarmi su dati reali (`false-positives.mjs`)

27.737 comandi bash delle sessioni Claude Code passate e 386.955 file di testo dei progetti (2,5 GB, `node_modules` inclusi).

| | Prima | Dopo |
|---|---|---|
| comandi con conferma | 834 | 825 (heredoc che scrivono file non contano più) |
| conferme nuove | – | 38: quasi tutte vere (`cat .env.production`, `git branch -D` di lavoro non mergiato) |
| installazioni reali fermate | – | **0/28** pacchetti non famosi (prima della correzione: 4, parole come `2>&1`) |
| file con testo invisibile segnalato | – | **3/386.955** (bundle minificati con bidi); prima della correzione 295 (zero-width legittimi) |

I caratteri a larghezza zero non vengono più tolti dai risultati dei tool: compaiono in codice minificato e classi di
regex, e toglierli faceva fallire gli edit successivi. Si tolgono solo tag (testo ASCII invisibile che il modello legge) e
bidi.

## Catture (`catches.mjs`)

26 typosquat storici e nomi inventati (npm/PyPI): **21 fermati**. Sfuggono `cross-env.js`, `electorn`, `babelcli`,
`jquery.js`, `expresss`: esistono sul registry da anni (segnaposto di sicurezza di npm), nessun segnale per fermarli.

Dal vivo (Pi + Claude):
- un'istruzione nascosta in caratteri tag in un file letto è stata tolta, e il modello ha segnalato l'injection;
- un edit alla cieca su un file appena cambiato da un'altra sessione è stato fermato, e il modello ha conservato la riga dell'altra
  sessione;
- `npm i react-fluxion-hyperstate-zz9` è stato fermato con il motivo.

## /goal

Su `main` ogni continuazione automatica di `/goal` lanciava `TypeError: event is not a function` (il parametro dell'handler
copriva la funzione delle righe di evento): il goal non ripartiva mai da solo. Test di regressione in `goal.test.ts`,
rosso su `main`, verde qui.

`--metric` dal vivo: `app.js` da 599 a 62 byte in un giro, commit sul branch `goal/metric-…`, test verde.

## /land

Dal vivo da una worktree:
- rebase su `main` (che era avanzato);
- `npm test` verde;
- fast-forward del checkout di `main`.

Nei test: conflitto, controllo rosso e checkout sporco lasciano tutto com'era; la coda tiene le sessioni una alla volta.
