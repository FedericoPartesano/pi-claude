---
stato: bozza
---
# Design system — Neon Night (terminale)

Grafica solo testuale; il tema è `pi-ui/themes/neon-night.json` (alternativa `lilla`).

- Colori: sfondo `#0c0c0c`, pannello `#13121a`, testo `#dcdfe8`, attenuato `#858ba0`, debole `#4c5163`, bordo `#2e3140`; accenti magenta `#ff3fd8`, ciano `#2ee6ff`, giallo `#f5e14a`; stati ok `#3df2a0`, warn `#f5b942`, err `#ff4d6d`; diff `#7cf5bd`/`#ff8fa8`.
- Cockpit: grafica sobria. Stato mai solo col colore: simbolo + testo (✓ verde, ● in corso, ✗ rosso, ○ da fare; PROCEDE/A RISCHIO/FERMA/SERVE TE in maiuscolo).
- Caratteri: quelli del terminale; caratteri larghi/emoji contati 2 colonne; testo a capo consapevole di ANSI, senza tagli a metà parola.
- Spazi/angoli: griglia a colonne; larghezze di riferimento 60, 80, 110; <70 impilato, ≥110 pannello laterale. Bordi leggeri a riga, niente angoli arrotondati particolari.
- Componenti: testata a una riga, elenco requisiti scorrevole, passo in diretta, riga dei tasti, avviso di 5 s, dialog select/confirm/input/editor, card dei questionari.
- Prestazioni: niente lavoro per frame, stringhe statiche in cache, frame in streaming limitati a `PROTO_FPS` (30).
- Lingua UI: italiano.
