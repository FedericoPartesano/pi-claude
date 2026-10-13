# Sonnet ai livelli di Opus, con l'aiuto di Pi

Stato: proposta, da riprendere. Nessun codice scritto.
Data: 2026-10-13.

## La proposta (dell'utente)

Raggiungere con Sonnet risultati vicini a quelli di Opus, senza cambiare modello, grazie a
strategie messe in campo da Pi: strumenti di supporto e di controllo che aiutano Sonnet dove
oggi sbaglia o si ferma troppo presto. L'obiettivo è avere la qualità di Opus su analisi e bug
difficili consumando la quota di Sonnet.

## Cosa ne penso

Credo sia possibile in parte, non del tutto.

- Il ragionamento grezzo non si aggiunge da fuori: capire un bug sottile o tenere a mente molte
  cose insieme resta più forte in Opus.
- Molti errori di Sonnet però non sono «non sa ragionare»: salta una verifica, si ferma alla
  prima ipotesi, non rilegge il proprio lavoro, dichiara «fatto» troppo presto. Questi errori
  di processo Pi li può compensare dall'esterno, con controlli che non dipendono dal modello.
- Il guadagno va misurato, non supposto. La memoria di sessione (stash e archivio) sembrava
  utile ma, misurata, costava +19,6% e +6,5% di token senza benefici: è stata scartata.
  Qui deve valere la stessa regola: si tiene solo ciò che migliora i risultati misurati.

## Soluzioni progettuali

Ordinate dalla più promettente. Ognuna deve poter essere spenta con una variabile d'ambiente.

### 1. Verifica obbligata prima di «fatto»

Problema: Sonnet chiude il lavoro senza aver eseguito test, controllo dei tipi o una prova reale.

Progetto:
- Pi osserva il turno (`pi.on("agent_end")` o simile): se nel turno ci sono state modifiche a
  file di codice ma nessun comando di verifica (test, `tsc`, build, esecuzione), Pi aggiunge un
  promemoria e il modello continua, come fa già `/goal` quando il modello si ferma senza
  `goal_done`.
- I comandi di verifica si scoprono dal progetto (script `test`/`build` nel `package.json`,
  blocco «Verifica» dell'intent, `--check` di `/goal`).
- Limiti di sicurezza: al massimo un promemoria per turno, nessun promemoria se il modello ha
  spiegato perché non può verificare.
- Costo: zero token quando il modello verifica da solo; un breve messaggio altrimenti.
- Riuso: logica di continuazione di `extensions/goal.ts`, guardie di `extensions/guards.ts`.

### 2. Più ipotesi sui bug

Problema: sui bug Sonnet si fissa sulla prima spiegazione plausibile.

Progetto:
- Quando la richiesta sembra un bug (errore incollato, «non funziona», «perché», stack trace),
  Pi aggiunge un'istruzione breve: elencare 2-3 ipotesi, per ognuna una prova che la conferma o
  la scarta, correggere solo dopo.
- Il riconoscimento usa un'euristica locale, senza chiamate al modello, sullo stile di
  `extensions/work-advisor.ts`.
- C'è già lo skill `diagnosing-bugs`: valutare se basta proporlo in automatico.

### 3. Critico separato prima della consegna

Problema: nessuno rilegge la modifica con occhi diversi.

Progetto:
- Prima del «fatto», una seconda chiamata riceve il diff e la richiesta originale e cerca
  errori, casi non coperti e requisiti dimenticati. Risponde in JSON (`ok` oppure un elenco di
  problemi). Se trova problemi, il modello principale li corregge.
- Va usato solo quando il diff supera una soglia (per esempio 30 righe), per non pagarlo sulle
  modifiche banali.
- Il critico può essere Sonnet stesso, con un prompt diverso, oppure Opus (vedi punto 4).

### 4. Opus come consulente nei momenti chiave

Idea: Sonnet fa il lavoro, Opus interviene solo dove pesa di più.

Progetto:
- Opus scrive il piano iniziale delle richieste grandi (analisi, refactoring, bug difficili).
- Opus fa il controllo finale del punto 3.
- Tutto il resto (letture, modifiche, comandi) lo fa Sonnet.
- Consumo atteso: una piccola frazione rispetto a usare Opus per tutta la sessione, perché
  Opus vede solo la richiesta, il piano e il diff, non tutta la cronologia.
- Il provider `pi-claude-code` ha già sia `sonnet` sia `opus`; la chiamata si fa con
  `ctx.modelRegistry.streamSimple`, come `/dream` fa con haiku.
- Rischio: se Opus deve leggere molti file per capire il contesto, il risparmio sparisce.
  Da misurare.

### 5. Ragionamento alto solo quando serve

Progetto:
- Su analisi e debug, Pi alza il livello di ragionamento (`pi.setThinkingLevel`) per quella
  richiesta e lo riporta al valore normale dopo.
- Il footer mostra già «ragionamento <livello>», quindi il cambio resta visibile.
- La scelta del modello resta manuale (decisione dell'utente del 2026-10-13): qui si cambia
  solo il livello di ragionamento, non il modello.

## Come misurare (da fare prima di costruire)

1. Scegliere 8-10 compiti reali dove Opus e Sonnet danno risultati diversi: bug sottili, analisi
   di codice, richieste vaghe. Fonti: sessioni passate in `~/.pi/agent/sessions/`, pacchetti bug
   in `~/.pi/bugs/`, il repository `marked` già usato per le prove dei token.
2. Per ogni compito definire prima un criterio di riuscita verificabile (test che passa,
   requisiti soddisfatti), non un giudizio a occhio.
3. Eseguire tre configurazioni con l'harness esistente (`eval/harness.mjs`):
   - Sonnet senza aiuti;
   - Sonnet con le strategie, una alla volta e poi insieme;
   - Opus senza aiuti.
4. Contare compiti riusciti, token consumati (stessa formula token-equivalenti delle prove
   precedenti) e tempo.
5. Tenere solo le strategie che portano Sonnet più vicino a Opus a un costo minore di Opus.

Criterio di successo proposto: Sonnet con aiuti risolve almeno l'80% dei compiti che Opus
risolve, consumando meno della metà della quota di Opus.

## Domande aperte

- Quali compiti usare per la misura: scelti dall'utente o estratti dalle sessioni passate?
- Il consulente Opus (punto 4) è accettabile o deve restare tutto su Sonnet?
- Tetto di consumo per la prova (numero di esecuzioni, quota massima).
