---
type: entity
title: chat-rpc (frontend su RPC)
tags: [interfaccia, prestazioni]
related: [pi-ui]
created: 2026-11-06
updated: 2026-11-12
---

# chat-rpc

Frontend scritto da zero sopra `pi --mode rpc` (`prototype/rpc-chat/chat.mjs`, un file, zero dipendenze). È la UI predefinita proposta al posto di [[pi-ui]]: `pi` lancia `bin/pi.mjs`, che avvia la chat; `pi --classic` o `PI_UI_CLASSIC=1` danno la UI classica; `-p`, `--mode`, sottocomandi e stream non TTY restano classici.

- Funzioni: sessioni (`/resume`, `/name`), barra con usage 5h/7g, pannello laterale (intent, goal, piano `todo`, test, git; `alt+s`), monitor test e barra timeout come widget testuali (`extensions/widget-compat.ts`), pager per `/archive`, `/bugreport` a dialog, immagini kitty e incolla di immagini. L'elenco di parità, con le voci scartate e il motivo, è in `prototype/rpc-chat/README.md`.
- Misure (Proxmox LXC 301, replay, 5 giri alternati, `eval/ui/REPORT.md` «Lotto 2»): testo 8,36 s contro 35,4 s di Pi con pi-ui (4,23×, soglia 1/4 = 8,85 s, margine 5,5%); ricco 5,19 s contro 40,2 s (7,7×).
- Limiti: misure su replay sintetico e una macchina; macOS e Windows non provati; prova manuale nel TUI reale dell'utente ancora da fare.

## Cockpit di `/auto`
Vista a schermo intero della corsa (`prototype/rpc-chat/cockpit.mjs`), aperta con `alt+a` o `/auto` senza argomenti. Salute (PROCEDE, A RISCHIO, FERMA, SERVE TE) con motivo, requisiti, passo in diretta, ←/→ per i passi passati. Guida: `p` pausa/riprendi, `:` nota, `s` stop (anche `/auto pausa|riprendi|nota`). In RIVEDI la testata dice «RIVEDI passo k di n»; `esc` torna alla diretta, in diretta chiude; riga dei tasti contestuale, stati vuoti con messaggio, timer che ridisegna solo la testata (perf: `eval/ui/REPORT.md`). Dati da file (stato JSON + diario `<slug>.eventi.jsonl`) con `fs.watch`, percorso via `setStatus("auto-run")`: 0 token, nessun traffico RPC. Timer da 1 s solo a vista aperta e corsa attiva. Micro-misura: 0,049 ms per frame; soglia 1/4 sul Proxmox non ancora misurata. Intent: `intents/2026-11-12-cockpit-di-auto-mode.md`.
