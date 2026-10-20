---
type: concept
title: Ricerca ibrida (vettori + BM25)
tags: [ricerca, embedding]
related: [extension-vault, solo-vettori-vs-ibrido, la-soglia-coseno-regge-su-un-vault-reale]
created: 2026-10-20
updated: 2026-10-20
---

# Ricerca ibrida (vettori + BM25)

Coseno sui vettori di e5-small più BM25, fusi con RRF. Pavimento del coseno: pavimento del modello + 0.06 (0.84). BM25 fa entrare un chunk da solo solo con query corte (meno di 4 parole utili) e con una parola rara (presente in al massimo il 3% dei chunk); con query più lunghe riordina soltanto. Motivo e numeri: [[solo-vettori-vs-ibrido]]. Domanda aperta: [[la-soglia-coseno-regge-su-un-vault-reale]].
