# pi-ui — chat di Pi ridisegnata (Neon Night) — design

Data: 2026-10-07 · Stato: approvato in chat, prova completata · Riferimenti: review di Claude Design "Pi TUI Definitivo" (Neon Night,
11 schermate 80/120 colonne), prova `pi-ui/prototype/PROTOTYPE-spike.ts` (catture in `Download\pi-ui-prove`).

## Obiettivo
Una chat più compatta stile Claude Code che dice sempre cosa sta succedendo, mostra le immagini anche in tmux/WSL
e ha un'estetica futuristica cyberpunk sobria. Tutto con le API di estensione di Pi 1.0.4, senza toccare Pi,
**a costo zero in token** salvo i suggerimenti (opzionali, ~50 token).

## Principi (dal design)
1. La **barra di stato** sopra l'editor dice sempre cosa succede, un colore per stato:
   ciano AL LAVORO · giallo TOCCA A TE · rosso FERMO · verde FATTO (grigio PRONTO a riposo).
2. Il turno è una **lista di passi** in linguaggio naturale; il nome del tool è una nota, nascosta sotto 100 colonne.
3. **Tutto è piegato tranne l'errore.** `Ctrl+O` apre i dettagli (comportamento esistente di Pi).
4. A fine turno restano la risposta, il risultato e fino a **4 suggerimenti numerati**.
5. Lo stato della sessione (GOAL/LOOP/TEAM, file, test, immagini, uso) sta in un **pannello**; senza pannello resta
   un footer di una riga.

## Cosa cambia rispetto al design (verificato nella prova)
| Design | pi-ui | Motivo |
|---|---|---|
| Header fisso in alto | header all'avvio + progetto/branch/✚ nel **footer** | l'header di Pi scorre via con la chat |
| Binario laterale fisso a 120 colonne | **pannello a comparsa** `Alt+S` / `/pannello` (overlay a destra, non ruba la tastiera) | Pi non restringe la chat: un pannello fisso la coprirebbe |
| `Ctrl+B` pannello | `Alt+S` (configurabile `PI_UI_PANEL_KEY`) | `Ctrl+B` è il prefisso di tmux; `Alt+I`/`Alt+O` sono di komorebi/whkd |
| Turni precedenti su una riga, Invio su un passo | solo le righe dei passi si comprimono; `Ctrl+O` globale | i messaggi utente/modello li disegna Pi, nessuna selezione per voce |
| Frasi tipo "Correggo totalValue" | frasi dedotte da tool e argomenti ("Modifico cart.js", "Eseguo i test") | il modello non le fornisce; niente token in più |

### Tecniche verificate nella prova (2026-10-07)
- **Lista dei passi senza righe vuote**: Pi mette una riga vuota prima di ogni riga di tool, ma la omette se il
  componente (con `renderShell: "self"`) non disegna niente. Quindi la **prima riga di tool del turno disegna l'intera
  lista**, le altre restituiscono zero righe. Così funzionano anche la compressione a fine turno e l'errore aperto.
- **Pannello**: overlay `top-right`, `nonCapturing: true` (si scrive nel prompt col pannello aperto); quando è aperto le
  righe dei passi si restringono per non finirci sotto. Il testo delle risposte resta coperto: limite accettato.
- **Frasi bash**: divisione del comando su `&&`, `||`, `;`, `|` fuori dagli apici, corpo degli heredoc ignorato; un
  `tail`/`grep` senza file è un filtro e non conta. Verbi: test, build/lint/typecheck, commit, git, modifico (sed -i),
  scrivo (`cat >`, tee), leggo, cerco, installo, eseguo <script>.
- **Esito dei controlli**: non basta leggere il testo (il modello filtra l'output con `grep`/`tail`): servono anche
  il codice d'uscita del comando e, se c'è, il conteggio `fail N`. Un controllo fallito nel turno → barra FATTO con
  avviso `⚠` (o FERMO se è l'ultimo passo e il modello si è fermato lì).
- **Errori dei test**: dall'output di node:test si ricavano nome, `file:riga` e "ricevuto X, atteso Y"; si mostrano
  al posto dell'output grezzo (fino a 4).
- `quietStartup: true` toglie l'elenco di skill/estensioni all'avvio; l'header resta solo come banner iniziale.

## Palette Neon Night
`bg #0c0c0c` · `panel #13121a` · `userBg #1c1326` · `codeBg #16161f` · `text #dcdfe8` · `dim #858ba0` ·
`faint #4c5163` · `border #2e3140` · magenta `#ff3fd8` (marchio, editor, etichette) · ciano `#2ee6ff` (tool, link,
lavoro) · giallo `#f5e14a` (codice inline, ✚, tocca a te) · ok `#3df2a0` · warn `#f5b942` · err `#ff4d6d` ·
diff: `+#7cf5bd/#0e2a20`, `−#ff8fa8/#2f1220`. Simboli: `❯` utente, `◇` pensiero, `◆` tool, `⬢` risposta, `▸` elenchi,
`▰▱` barre, cornici con angolo tagliato `╱`.

## Pacchetto `pi-ui/`
Pacchetto Pi (come `pi-picker`): `pi install` da `install.sh`, attivo in `pi` e `pi-full`. Il tema è nel pacchetto e
`install.sh` imposta `theme: "neon-night"` e `quietStartup: true` solo se l'utente non ha già scelto altro.
`PI_UI=off` disattiva tutto (tema escluso); ogni modulo ha la sua variabile (`PI_UI_IMAGES=0`, …).

| Modulo | Responsabilità | API Pi |
|---|---|---|
| `themes/neon-night.json` | colori di Pi per ruolo (messaggio utente, markdown, codice, diff, sintassi) | tema da pacchetto |
| `src/status.ts` | stato del turno (macchina a stati pura: eventi → PRONTO/AL LAVORO/TOCCA A TE/FERMO/FATTO, attività, passo, secondi, token) | eventi `agent_*`, `tool_execution_*`, `message_end` |
| `src/status-bar.ts` | barra di stato sopra l'editor; nasconde l'indicatore standard | `setWidget(aboveEditor)`, `setWorkingVisible(false)` |
| `src/editor.ts` | editor con cornice `╱─ PROMPT ──┐ … └──╱`, magenta a riposo, grigio al lavoro; tasti `1`–`4` a editor vuoto scelgono un suggerimento | `setEditorComponent` + `CustomEditor` |
| `src/footer.ts` | una riga: `GOAL n/max  LOOP hh:mm  TEAM n/m` · progetto `⎇ branch ✚n` · `5H % · CTX % · modello·thinking` | `setFooter` (+ file d'uso dell'abbonamento, `getContextUsage`) |
| `src/steps.ts` | una riga per passo: icona (spinner/✓/✗) · frase · tool (≥100 col) · argomento · esito; piegato salvo errore o `Ctrl+O`; a fine turno i passi riusciti si comprimono in `✓ N passi · F file · T test ok ▸ ctrl+o dettagli` | `registerToolRenderer` (tutti i tool, `renderShell: "self"`) |
| `src/phrases.ts` | frase ed esito per tool: read/edit/write/bash/grep/web/team/img; bash: separa `&&`/`;`/`|` e sceglie il comando significativo (test, git, build, lettura) | funzioni pure |
| `src/test-output.ts` | legge l'output di node:test, jest, vitest, pytest → pass/fail e test falliti con `file:riga` | funzioni pure |
| `src/diff.ts` | diff compatto con numeri di riga e sfondo verde/rosso, max 6 righe poi `… altre N` | funzione pura |
| `src/images.ts` | trova percorsi/URL di immagini in risposte e risultati; aggiunge in chat una voce con miniatura a mezzi blocchi (PNG/JPEG con `pngjs`/`jpeg-js`; altri formati: solo link); URL scaricati in `~/.cache/pi-ui/` (≤10 MB) | `appendEntry` + `registerEntryRenderer` (non va al modello) |
| `src/gallery.ts` | `/img`: immagini della sessione nel picker, anteprima-miniatura; Invio apre con `wslview` (altrimenti `xdg-open`/`open`) | `pi-picker` |
| `src/answer.ts` | `⬢` davanti alla risposta; percorsi `file:riga` resi link `vscode://` (VS Code in WSL) | `registerMarkdownTransformer` |
| `src/suggestions.ts` | chiede al modello, in coda al system prompt, fino a 4 suggerimenti in un blocco riconoscibile; li toglie dalla risposta e li mostra `[1] … [4]` | `before_agent_start`, transformer, entry |
| `src/permission.ts` | sostituisce il dialogo di `permission-gate`: TOCCA A TE nella barra con `s` sì · `n` no · `a` sempre per questo comando | `tool_call` + input dell'editor |
| `src/panel.ts` | `Alt+S`: overlay a destra, non cattura la tastiera: SESSIONE (goal/loop/team), FILE (git status), TEST falliti, IMMAGINI (ultima miniatura), USO (5h, 7g, contesto) | `ctx.ui.custom(overlay, nonCapturing)` |
| `src/notify.ts` | turno > 30 s: campanella + notifica Windows via `powershell.exe` (API Windows di sistema, senza moduli da installare) | `agent_settled` |
| `src/session-bus.ts` | goal/loop/team pubblicano il loro stato su `pi.events`; pi-ui lo legge per footer e pannello. Senza pi-ui restano i `setStatus` attuali | `pi.events` |

### Stati della barra
| Stato | Quando | Testo |
|---|---|---|
| PRONTO | sessione ferma | `PRONTO` |
| AL LAVORO | da `agent_start` a `agent_settled` | spinner · attività corrente ("eseguo npm test", "penso…") · passo N · secondi · `esc interrompi` |
| TOCCA A TE | permesso in attesa o goal `blocked` | domanda · `s` sì `n` no `a` sempre |
| FERMO | turno finito con l'ultimo passo fallito, o interrotto | motivo con link `file:riga` · `r` riprova · `↵ scrivi tu` |
| FATTO | turno finito bene | secondi · ↑ token in · ↓ token out · `1-4 suggerimenti` se ci sono |

### Errori e casi limite
- Terminale stretto (< 60 colonne): la riga del passo mostra solo icona, frase ed esito.
- Fuori dalla TUI (`-p`, json, rpc): pi-ui non registra niente.
- Immagine illeggibile o troppo grande: voce con solo il link e il motivo.
- Il file d'uso dell'abbonamento manca: `5H –`.
- Nessun repo git: niente branch e niente FILE nel pannello.

## Test
- Funzioni pure con `node --test`: macchina a stati, frasi (anche comandi concatenati), lettura output dei test,
  diff, miniature a mezzi blocchi (immagine sintetica), ricerca immagini, link `file:riga`, parsing suggerimenti.
- Rendering a larghezza fissa (80 e 120): ogni riga `visibleWidth === width`, come nel picker.
- Ogni PR: prova in tmux 120 e 80 colonne, catture HTML → PNG con Chrome headless, confronto con le schermate del design.

## Piano di consegna (5 PR)
1. Tema, stato, barra di stato, editor, footer (+ `quietStartup`).
2. Passi, frasi, diff, lettura dei test, compressione a fine turno.
3. Immagini, `/img`, link nelle risposte.
4. Suggerimenti, permesso nella barra, notifica.
5. Pannello `Alt+S` e bus di sessione per goal/loop/team.

## Fuori scope
TUI `/memory` (progetto separato, userà gli stessi colori), chat interamente custom fullscreen, frasi generate dal
modello per ogni passo (eventuale miglioramento dopo la PR 2).
