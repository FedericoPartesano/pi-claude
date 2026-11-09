# Sistema di animazioni del prototipo RPC
Aggiornato: 2026-11-09 · fase 1 (confermato) · profilo: rapido · tema: animazioni-tui

## Problema e contesto
Il prototipo (`prototype/rpc-chat/chat.mjs`, UI predefinita di Pi) ha animazioni sparse: orologio a 8 fps per spinner e respiro della barra, toast lineare da 180 ms, streaming a 15 fps; tutto il resto è statico (dialog, questionario, barre, suggerimenti). Si vuole un sistema unico, fluido e ultra ottimizzato per toast e altri elementi, nel rispetto del mantra (token, poi velocità e leggerezza). Se non si fa: animazioni a scatto, codice duplicato per effetto.

## Risultato atteso
Chi usa Pi vede entrate e uscite morbide di toast, dialog e barre, senza sfarfallio né ritardi, e il costo CPU misurato sul Proxmox resta sotto la soglia di 1/4 di Pi.

## Modo di fallimento
Il carico di test sul Proxmox (testo o ricco) supera la soglia (8,71 s testo, 10,1 s ricco; oggi 2,67 s e 3,61 s), oppure l'animazione causa sfarfallio visibile o riscrive righe non cambiate. Visibile alla prima rimisura dopo l'implementazione.

## Vincoli duri
- Node ≥ 22.19, zero dipendenze nuove, ESM puro in `chat.mjs`, sezione estraibile nel banco `perf-harness.mjs`.
- Windows (WezTerm/ConPTY, Windows Terminal), macOS, WSL; terminali lenti ammessi.
- A riposo: zero timer e zero lavoro per frame. `PROTO_ANIM=0` spegne tutto.
- Nessun commit senza richiesta; commenti in inglese, documenti in italiano.

## Scenari di qualità
| Scenario | Misura | Peso | Portante |
|---|---|---|---|
| Costo CPU | Proxmox, 5 giri alternati, mediana ≤ 1/4 di Pi (testo 8,71 s, ricco 10,1 s) | 5 | sì |
| Costo a riposo | nessun timer attivo, 0 scritture a terminale quando nulla si muove (test nel banco) | 5 | sì |
| Fluidità | transizione 120–250 ms con ≥ 6 frame distinti a 30 fps; frame adattivo se la scrittura supera il budget | 4 | no |
| Latenza di input | un tasto premuto durante un'animazione si disegna entro 1 frame (≤ 33 ms) | 4 | no |
| Assenza di sfarfallio | solo righe cambiate (diff), `?2026` sincronizzato dove supportato | 3 | no |
| Manutenibilità | una sola API per nuove transizioni; effetto nuovo ≤ 10 righe | 2 | no |

## Ipotesi da smontare e candidata dichiarata
Candidata: un solo orologio con scheduler di transizioni (durata, easing, valore 0→1), attivo solo se ha transizioni vive; frame rate adattivo misurando il tempo di scrittura; blocchi frazionari per le barre. Elementi: toast, dialog e questionario, barre USO e di avvio, spinner e pensiero. Esclusi: scorrimento morbido della chat, cascata dei suggerimenti.

## Riferimenti amati / odiati
Da cercare in fase 3 (TUI con animazioni fluide: Textual, Bubble Tea/Harmonica, Ratatui/tachyonfx, Ink, notcurses). Odiato: sfarfallio, ridisegno completo a ogni frame.

## Decisioni del round 2
- L'input ha sempre la precedenza sul frame animato.
- Un frame animato non ridisegna le righe con immagini kitty.
- `PROTO_ANIM=reduced`: solo cambi di stato, senza movimento né easing.
- Orologio iniettabile (`now()`) per test deterministici.
- Sincronizzazione `?2026` dove supportata, ignorata altrove.

## Fuori perimetro e anti-obiettivi
UI classica `pi-ui`, nuove dipendenze, effetti decorativi senza funzione (particelle, arcobaleni, rumore animato). Anti-obiettivo: animazione che ritarda l'input o fa salire la CPU a riposo.

## Decisioni già prese (ADR letti)
Nessun ADR nel repo. Decisioni di progetto: grafica sobria e minimale (#r166), animazioni solo con un orologio e `PROTO_ANIM=0` (#r165), rimisura sul Proxmox dopo ogni lotto, 15 fps in streaming.
