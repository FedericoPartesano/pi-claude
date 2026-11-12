---
stato: bozza
---
# Piano di implementazione

Stato attuale: pacchetto completo e cockpit del primo lotto presente. Ordine a piccoli passi, ognuno con test prima del successivo (`node scripts/t.mjs auto-cockpit auto`).

1. Misura di base: `perf.test.mjs`, 5 giri alternati, mediana; dato in `eval/ui/REPORT.md`.
2. `wrapPlain` e righe a larghezza data (60/80/110) con test.
3. Testata a una riga (fase, passo, salute+motivo, tempo, «fermo da Ns»); test righe.
4. Elenco requisiti `n/m` con evidenza del corrente e scorrimento (test con 3 e 40).
5. Passo in diretta: ultimi tool + testo finale a capo pulito.
6. Layout adattivo <70 colonne; verifica in pty con `--cols`.
7. RIVEDI «k di n», esito/durata/token, ritorno con esc/→; pty con ←/→/esc.
8. Stati vuoti e anomali, uno per test.
9. Riga dei tasti contestuale (`nextKey`) e «in attesa: …».
10. Test su timer unico da 1 s e ridisegno solo testata; rimisura CPU (≤ +10%) e report.
11. Documentazione: README del prototipo, sezione `/auto` del README, `chat-rpc.md`, `log.md`.
12. Chiusura: `node --test extensions/*.test.ts`, `tsc -p` per bridge e pi-ui; commit Conventional, niente push.
