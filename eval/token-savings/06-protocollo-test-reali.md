# Protocollo dei test reali (le 3 metriche sacre)

Decide solo il test. Una soluzione entra solo se, rispetto a Pi senza di essa (stessi casi, stesso modello):
1. **Affidabilità e profondità**: stessi esiti sui casi con controllo automatico (eval/cases.mjs, lean/e4-cases.mjs) e,
   per le risposte aperte, nessun fatto in meno (checklist di fatti attesi) e nessuna rilettura in più che annulli il risparmio.
2. **Velocità**: tempo totale e numero di chiamate non peggiori (tolleranza +5%).
3. **Token**: costo in token equivalenti (lettura 0,1, scrittura 1,25, output 5) dai `usage` veri, non da stime.

Condizioni A/B: Pi base (A) contro Pi con la soluzione (B), ripetute 3 volte per ridurre il rumore.
Scenario: sessioni LUNGHE (contesto oltre 40k token), perché sotto quella soglia non c'è nulla da risparmiare: i casi da 1 turno
dell'harness attuale non bastano. Si usano catene di 8-12 domande/modifiche sul repo `marked` (pinned) e sulla fixture.

Ipotesi da verificare, in ordine di costo:
- H1 livelli di risoluzione del contesto (intero / riassunto / puntatore) a blocchi, con recupero su richiesta.
- H2 limite ai risultati lunghi (testa+coda) con rilettura possibile.
- H3 indice del progetto: già provato in lean/E4 (search usato 1 volta su 50, guadagno 3,6%): scartato come leva principale.
- H4 modello piccolo per i passi di sola esplorazione (tetto teorico 30%).
Criterio di chiusura: stima combinata ≥50% misurata sui `usage` veri, con le metriche 1 e 2 invariate.
