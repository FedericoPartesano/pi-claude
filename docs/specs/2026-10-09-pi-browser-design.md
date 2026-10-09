# pi-browser: un Chrome che Pi pilota e tu vedi — design

Data: 2026-10-09 · Stato: **bozza, da approvare** · Base: ricerca (agent-browser, Playwright MCP, Chrome DevTools MCP,
Stagehand, Carbonyl, protocolli grafici) e prova usa e getta (CDP da WSL, screencast, clic, mezzi blocchi).

## Perché
Pi oggi non vede le pagine web: legge solo testo con `fetch_content`. Per collaudare una UI, compilare un form o seguire
un flusso con login serve un browser vero. Le soluzioni pronte (Playwright MCP, Chrome DevTools MCP) aggiungono 20–30 tool
fissi, cioè migliaia di token in ogni richiesta anche quando il browser non serve, e questo va contro la regola del
costo fisso zero.

## Criteri di accettazione (misurati prima del merge)
1. **Costo fisso zero.** Senza usare il browser la prima richiesta è identica a oggi: A/B con `eval/guards/tokens.mjs`.
   Avvio di Pi non rallentato.
2. **Pochi token per pagina.** Su 5 pagine vere (una lista, un form, una dashboard, una pagina lunga, una SPA) l'istantanea
   costa meno di Chrome DevTools MCP e di Playwright MCP sulle stesse pagine. Dopo un'azione arriva solo cosa è cambiato.
3. **Funziona.** Su 5 compiti veri (cerca e apri, compila e invia un form, login con sessione già aperta, verifica di un
   testo dopo un clic, errore in console) almeno 4 su 5 riescono senza screenshot.
4. **Lo vedi.** La pagina pilotata è una finestra Chrome vera, sia da Linux sia da Windows/WSL, con qualunque terminale.
5. **Sicuro.**
   - Un sito nuovo chiede conferma.
   - Il testo delle pagine è trattato come non fidato: passa dalle guardie Unicode e non vale come istruzione.
   - Nessuna password viene digitata da Pi.

## Architettura

### Motore: CDP diretto, niente dipendenze
Un client DevTools Protocol in Node, con il `WebSocket` integrato e senza Playwright né Puppeteer. Nella prova un client
così minimo bastava per navigare, cliccare a coordinate, valutare JavaScript e ricevere lo screencast. `agent-browser`
(Rust) resta il riferimento per il formato dell'output, non una dipendenza: aggiungerebbe un binario da installare per
piattaforma.

### Un solo tool, caricato a richiesta
Il tool `browser` sta nel gruppo `browser` di `tool-groups.ts`: inattivo finché il modello non chiama
`load_tools(browser)`. È un solo tool con un parametro `action` invece di 6 tool separati, per pagare lo schema una volta
sola:

| action | cosa fa | cosa torna al modello |
|---|---|---|
| `open {url}` | naviga (chiede conferma per un sito nuovo) | titolo + istantanea compatta |
| `snapshot {scope?}` | rilegge la pagina | istantanea compatta; `scope` = un riferimento per leggere solo quella parte |
| `act {ref, do: click\|type\|select\|press\|hover, text?}` | agisce su un riferimento | **solo le differenze** dall'istantanea precedente |
| `eval {js}` | esegue JavaScript nella pagina | risultato (troncato, oltre il limite va su file) |
| `shot {ref?}` | screenshot, con i numeri dei riferimenti disegnati sopra (set-of-marks) | percorso del file; immagine solo se il modello è multimodale |
| `logs` | errori di console e richieste fallite dall'ultima lettura | elenco compatto |

### Istantanea compatta
L'albero di accessibilità (`Accessibility.getFullAXTree`) ridotto così:
- **solo elementi interattivi o con testo**, con ruolo, nome e stato (`[e12] button "Salva" disabled`), indentati;
- **riferimenti stabili**: un elemento che sopravvive tra due letture mantiene il suo `eN` (legato al `backendDOMNodeId`);
- **tetto**: oltre circa 4k caratteri va su file, e al modello arrivano l'inizio e il percorso;
- **diff dopo ogni azione**: righe aggiunte, tolte, cambiate, più il nuovo URL se c'è stata navigazione.

### Connessione: prima il tuo Chrome, poi uno nuovo
1. **Il tuo Chrome aperto**, se ha il debug remoto attivo (Chrome 146+, `DevToolsActivePort` nel profilo): ha già i tuoi
   login. Chrome mostra il permesso a ogni connessione e la barra "controllato da software automatico".
2. **Altrimenti un Chrome nuovo** con un profilo persistente di Pi (`~/.cache/pi-browser/profile`), in **modalità app**
   (una finestra senza barre) accanto al terminale. È la vista live per te: fedeltà piena e nessun lavoro di rendering
   nel terminale.
3. **WSL**: verificato `google-chrome` Linux via WSLg, CDP su localhost. Il Chrome di Windows richiede di inoltrare la
   porta, perché la rete WSL è in NAT: lo si valuta in fase 2.

### Cosa vedi in Pi
Una riga nel pannello di pi-ui (`🌐 <titolo> · <sito>`) e l'ultima azione. L'anteprima della pagina dentro il terminale
è la fase 3, opzionale, rilevata per terminale:
- kitty, iTerm2 o sixel dove supportati;
- mezzi blocchi compatti come ripiego (nella prova: 0,7 ms e 8 KB per fotogramma ridisegnato);
- disattivata sotto ConPTY/WSL, che scarta le sequenze grafiche.

## Fasi
1. **Nucleo**:
   - tool `browser` nel gruppo lazy;
   - connessione al tuo Chrome o avvio in modalità app;
   - `open`, `snapshot`, `act` con diff, `eval`;
   - conferma per sito;
   - misure dei criteri 1–3.
2. `shot` con set-of-marks, `logs`, Chrome di Windows da WSL, riga nel pannello di pi-ui.
3. Anteprima nel terminale per i terminali che la reggono.

## Fuori perimetro
Browser disegnato nel terminale come vista principale (Carbonyl, Browsh), pilotaggio con le sole immagini, gestione delle
password.

## Domande aperte per l'utente
1. Il collegamento al tuo Chrome deve essere predefinito, oppure preferisci sempre un profilo separato per Pi?
2. Quali siti vuoi tra i 5 compiti di misura, per esempio un'app che usi al lavoro in ambiente di test?
3. La conferma per sito va chiesta una volta per sessione o una volta per sempre (lista di siti fidati)?
