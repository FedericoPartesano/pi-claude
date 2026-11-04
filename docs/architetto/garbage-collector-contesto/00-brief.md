Aggiornato: 2026-11-03 · fase 6 (decisioni prese da Pi su delega dell'utente: «tutte le risposte devi deciderle tu in base allo studio»)

# Garbage collector del contesto

## Problema
Il contesto si riempie durante la chat. Idea dell'utente (candidata **GC**): un garbage collector che sposta ciò che è vecchio dal contesto in un cestino; il modello può richiamare dal cestino; un elemento richiamato torna nel contesto ma resta tracciato nel cestino; se richiamato tante volte diventa fisso nel contesto, altrimenti viene eliminato del tutto, anche dal cestino.

## Decisioni dell'utente
- Studio nuovo, riusa senza rifarli i vincoli e le misure di `../gestione-contesto-pi/` (soglia 30%, cache +19,6% decisione #r25, sessioni registrate rigiocate offline, compiti a risposta nota).
- Risultato atteso (tutti e tre, misurati insieme): (1) meno token e quota per sessione; (2) sessioni lunghe senza compattare; (3) risposte migliori con meno rumore.
- Modo di fallimento: **meno del 30% di token in meno, o qualità peggiore** (compiti a risposta nota che falliscono dopo il taglio).
- Perimetro: partire da **soli risultati dei tool e immagini**; poi provare anche **tutto** (testo del modello, messaggi dell'utente) come variante di test. Ogni variante si misura.
- Richiamo: **segnaposto nel contesto con id e descrizione; il modello richiama con un tool** (tool spento finché serve). Ogni richiamo è un voto.
- Promozione cestino → fisso: **soglia di richiami, da calibrare** con la simulazione.
- Svuotamento: **dopo N turni senza richiami**, N calibrato. Il transcript su disco di Pi resta intatto.
- Profilo di spesa: **profondo** (3 ricerche, 6 repo, 3 critici).
- Tema di conoscenza: `gc-contesto`.

## Vincoli già decisi (ereditati)
- Non riscrivere il contesto già inviato fuori da blocchi che ripaghino la cache.
- Costo fisso in token minimo: tool extra spenti finché non servono.
- Ogni affermazione su prestazioni va misurata e riportata in `eval/`.
- Funziona su Windows, macOS, WSL; nessuna dipendenza nuova.

## Candidate
- **GC** (dell'utente): cestino con richiamo e promozione.
- Base esistente: `extensions/context-tiers.ts` (digest di vecchi risultati, a blocchi).

## Scenari di qualità (pesi da confermare)
1. Quota (40, `portante`): token totali per sessione tipo, prima e dopo, stessa attività; ≥30% in meno.
2. Qualità (30): compiti a risposta nota dopo il taglio; il modello non perde file letti né decisioni.
3. Affidabilità (20): niente loop di compattazione; richiami che non annullano il risparmio; numero di compattazioni per ora.
4. Manutenzione (10): nessuna impostazione a mano; costo fisso del prompt invariato.

## Ipotesi da smontare
- Il conteggio dei richiami è un buon segnale di utilità (rischio: il modello non richiama ciò che non vede).
- Per tool e immagini la cancellazione totale è sicura perché ricostruibile rilanciando il comando.

## Decisioni prese da Pi (delega esplicita, in base allo studio)
- Pesi confermati 40/30/20/10: la misura ha reso la quota decisiva, ereditare i pesi non cambia l'esito.
- Perimetro: **solo tool e immagini**. La variante «tutto» è esclusa: testo e messaggi non sono rilanciabili (il cookbook Anthropic dice che il clearing non li tocca) e la quota è già fail senza di essi.
- Richiamo: **per rilancio** (segnaposto che dice come rifare), non un tool nuovo (costo fisso) né richiamo per somiglianza.
- Promozione: **nessuna** nel seme; non calibrabile (0–5 richiami in 400–1000 giri).
- Svuotamento: indice del cestino a 30 giri senza richiami nel replay; irrilevante finché non c'è cestino.
- Profilo: `profondo` dichiarato, eseguito in forma ridotta (3 profili repo su 6, nessun critico).
