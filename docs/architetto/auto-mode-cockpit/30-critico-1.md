# Critico 1 sulle alternative della forma (2026-11-12)
Revisore: `claude -p --model haiku`, sola lettura, senza il contesto della sessione; legge `30-forma-vista.md`, `00-brief.md`, `cockpit.mjs`. Citazioni di riga non ricontrollate da me.
(`pi -p` non è partito: token OAuth Anthropic di Pi scaduto, `invalid_grant`.)

## Difetti
1. Il «perché» della salute viene troncato dalla testata (`cockpit.mjs` ~236-240): a 100 colonne resta poco spazio, a 80 sparisce.
2. La striscia chat (fino a 10 righe) non è nel budget di nessuna alternativa: a 100×30 mangia il pensiero.
3. Sotto 80 colonne il corpo si tronca, non si impila: PASSO può sparire. Vale anche per B.
4. «Panoramica basta in 5 s» e «CPU invariata» non sono misurati; la prova a tempo del brief non è pianificata.
5. Falsificatore non misurabile (nessun contatore, nessuna soglia).
6. B riassegna `Tab` ma il brief mette il diff in `Tab`: scenario «profondità ≤2 tasti» sul diff non coperto.
7. `1…5` e `Tab` senza guardia in modalità chat/nota; `s` ferma senza conferma; `esc` con tre significati.
8. La scheda Piano duplica FASI e REQUISITI della Panoramica.
9. Alternativa mancante **D**: A + zoom sul pannello in focus (lazygit), un tasto allarga il pensiero a schermo intero; quasi B con meno codice e meno tasti.

## Regge
Panoramica con salute e «prossimo tasto»; funzioni di riga riusabili; ridisegno della sola testata e orologio unico.

## Verdetto: MODIFICA B
1. Motivo della salute su una riga propria; testata solo passo/fase/parola.
2. Chat fuori dal layout fisso (toggle o scheda) e righe contate nel budget; sotto 80 colonne nessuna perdita di PASSO.
3. Falsificatore con contatori locali (aperture JSON, cambi scheda, tempo alla risposta) e soglia pass/fail scritta prima; aggiungere D al confronto; tasti disattivati in modalità testo.
