---
stato: bozza
---
# PRD — pi-claude

## Cosa fa
Pi (earendil-works/pi) con i modelli Claude tramite l'abbonamento Claude Code: il bridge pilota il binario ufficiale `claude`. Sopra, una UI "Neon Night", memoria profonda, team di sub-agenti, goal/loop/intent e `/auto`, che porta un goal fino a un branch consegnato senza intervento (intent, requisiti con check, build, verifica, review).

## Per chi
Sviluppatore singolo (l'autore) che usa Pi da terminale con un abbonamento Claude Code e vuole risparmiare token e lavorare in autonomia.

## Principi (in ordine)
1. Risparmio di token (prompt fisso corto e stabile, tool spenti finché non servono).
2. Velocità e leggerezza (niente lavoro per frame, niente timer inutili).
3. Ogni affermazione su prestazioni o qualità è misurata e riportata in un report.

## Obiettivo corrente
Migliorare la schermata del cockpit di `/auto`: risposta a «sta procedendo? perché?» in una riga, elenco requisiti scorrevole, passo in diretta leggibile, layout adattivo (60–110 colonne), RIVEDI chiaro, stati vuoti gestiti, costo invariato (0 token, CPU entro +10%).

## Fuori
- API Anthropic con OAuth, spoofing.
- Nuove funzioni di guida di `/auto` (saltare/riordinare requisiti, modello per passo, presa in mano).
- Cambi alla UI classica (riga di stato, notifiche, `/auto status`) e ai check congelati.
- Multiutente, servizi in cloud, pagamenti.
