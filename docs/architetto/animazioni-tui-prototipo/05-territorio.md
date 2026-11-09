# Mappa del territorio: animazioni in TUI
Aggiornato: 2026-11-09 · fase 1b · fonte: conoscenza dell'assistente, NON verificata sul web (tool web non disponibili in questa sessione). Ogni voce va confermata in fase 2.

## Concetti
- Tween/transizione: valore 0→1 nel tempo con easing. `coperta`
- Frame budget e dirty-region: ridisegno solo delle righe cambiate. `coperta`
- Molla (spring, Harmonica di Bubble Tea) contro durata fissa con easing: la molla non ha durata e reagisce bene alle interruzioni. `non coperta`
- Delta-time contro frame-count: l'animazione segue il tempo reale, non il numero di frame. `non coperta`
- Interrompibilità: una transizione che riparte da dove si trova, senza salto. `non coperta`

## Pattern
- Tick unico con scheduler (Bubble Tea `tea.Tick`, Textual `set_interval`, Ratatui tachyonfx). `coperta`
- Aggiornamento sincronizzato `CSI ?2026 h/l` (synchronized output). `coperta`
- Blocchi frazionari `▏…█` per barre a 8 sub-posizioni. `coperta`
- Sfumatura di colore truecolor tra due tinte (fade) al posto del movimento. `non coperta`
- Spinner con frame statici precalcolati. `coperta` (già in uso)

## Trade-off
- Fluidità contro CPU: più fps = più byte scritti; sulle pipe lente (ConPTY, WSL) la scrittura domina. `coperta`
- Movimento contro fade di colore: il colore non sposta righe, costa meno. `non coperta`
- Durata fissa contro molla. `non coperta`

## Modi di fallimento
- Sfarfallio per scritture a metà frame. `coperta`
- Contropressione: il terminale non smaltisce e la coda cresce, input in ritardo. `non coperta`
- Timer che resta acceso a riposo. `coperta`
- Animazione che continua in sfondo con pannello nascosto o terminale non in focus. `non coperta`
- Ridisegno di immagini kitty. `coperta`

## Attributi di qualità
- Efficienza: coperta. Usabilità/accessibilità (movimento ridotto): coperta. Portabilità (terminali): coperta. Manutenibilità: coperta. Testabilità (orologio iniettabile): coperta.

## Non coperte → decisione di Federico
1. Contropressione di scrittura: se `stdout.write` ritorna `false`, saltare i frame animati finché non c'è `drain`. Proposta: affrontare.
2. Fade di colore al posto del movimento dove possibile (zero righe spostate, costo minimo). Proposta: affrontare.
3. Molla o durata con easing, con interruzione fluida. Proposta: affrontare, scegliendo la durata con easing se la molla non porta vantaggi misurabili.
4. Animazioni sospese quando il terminale non ha focus o il pannello è nascosto (`?1004` focus events). Proposta: differire (poco valore, caso raro).
