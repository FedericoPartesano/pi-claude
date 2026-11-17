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
Vista a schermo intero della corsa (`prototype/rpc-chat/cockpit.mjs`), aperta con `alt+a` o `/auto` senza argomenti. Salute (PROCEDE, A RISCHIO, FERMA, SERVE TE) con motivo, requisiti, passo in diretta (Panoramica rifatta 2026-11-16: ADESSO con l'azione in corso e da quanto, pensiero corrente a capo pulito, STORIA DEL PASSO cronologica, snapshot del pensiero ridotti all'ultimo), ←/→ per i passi passati. Guida: `p` pausa/riprendi, `:` nota, `s` stop (anche `/auto pausa|riprendi|nota`). In RIVEDI la testata dice «RIVEDI passo k di n»; `esc` torna alla diretta, in diretta chiude; riga dei tasti contestuale, stati vuoti con messaggio, timer che ridisegna solo la testata (perf: `eval/ui/REPORT.md`). Dati da file (stato JSON + diario `<slug>.eventi.jsonl`) con `fs.watch`, percorso via `setStatus("auto-run")`: 0 token, nessun traffico RPC. Timer da 1 s solo a vista aperta e corsa attiva. Micro-misura: 0,049 ms per frame; soglia 1/4 sul Proxmox non ancora misurata. Intent: `intents/2026-11-12-cockpit-di-auto-mode.md`.

## Sub-agenti
`bin/pi.mjs` carica `subagent` (upstream), `pi-team` e `extensions/tool-groups.ts` con i tool spenti: il modello li accende con `load_tools` (gruppi `subagent`, `team`, `parallel`, elenco ridotto da `PI_TOOL_GROUPS`). Costo fisso: la sola voce `load_tools`, non misurata. `PI_SUBAGENTS=off` li toglie. `bin/pi-full` ora carica `subagent/index.ts` (come cartella il tool non si registrava). Il pannello laterale ha la sezione SUB-AGENTI (`prototype/rpc-chat/agents.mjs`, test `extensions/rpc-agents.test.ts`): compare solo con un `subagent`/`team` in corso o finito da meno di 20 s. Provata solo nel pty con Pi finto, non con sub-agenti veri.

## Processi in background
Sezione PROCESSI del pannello (`prototype/rpc-chat/processes.mjs`, test `extensions/rpc-processes.test.ts`): un `bash` con `&`/`nohup`/`setsid` crea una riga con porta, pid (da `/proc`, solo Linux) e stato attivo/FERMO. Controllo ogni 2 s solo con processi attivi. Provata nel pty con un vero `http.server` ucciso a mano (attivo → FERMO); non provata con un `pi` reale. Limite: su un processo zombie il segnale 0 riesce, quindi risulta ancora attivo se la porta non è controllata.
