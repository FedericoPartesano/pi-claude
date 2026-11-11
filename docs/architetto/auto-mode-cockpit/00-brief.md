# Cockpit di auto mode: seguire, monitorare e guidare una corsa /auto
Aggiornato: 2026-11-11 · fase 1 confermata · profilo: profondo · tema: monitor-agenti

## Problema e contesto
`/auto` (ADR 0001) porta un goal da solo attraverso define → docs → plan → build → review → ship, con un processo figlio `pi -p` per passo nel worktree `auto/<slug>`. Oggi lo si segue solo da una riga di stato («auto build 3/12 · passo 5»), da notifiche su piano, verdi e stop e da `/auto status`. La guida si riduce a `/auto stop`. Lo stato completo è in `<repo>-auto/<slug>.json`; gli eventi dei figli (tool, testo) si leggono in diretta e si buttano. Per capire una corsa bisogna aprire JSON, `auto/decisioni.md`, l'intent e `git log` nel worktree. Se non si fa nulla, auto mode resta una scatola nera: chi la usa non si fida a lasciarla andare e non sa quando intervenire.

## Risultato atteso
Aprendo la vista capisci in ≤5 s dove è la corsa, se procede o gira a vuoto e perché; se sbaglia strada la correggi in ≤30 s, senza leggere log né file.

## Modo di fallimento
Nelle prime 3 corse vere con la vista disponibile, l'utente apre ancora il JSON di stato, `auto/decisioni.md` o i log per capire cosa succede o perché la corsa si è fermata.

## Vincoli duri
- Vista a schermo intero nel prototipo (`prototype/rpc-chat/chat.mjs`, client RPC Node a zero dipendenze); nessuna dipendenza nuova.
- UI classica (`pi --classic`): solo riga di stato, notifiche e `/auto status`, come oggi.
- CPU del prototipo ≤ 1/4 di Pi con `pi-ui` (Proxmox, carichi replay, 5 giri, mediana), anche con vista aperta e corsa attiva; niente lavoro per frame, orologio unico.
- 0 token per la vista: nessuna chiamata al modello per riassumere o spiegare.
- Supervisore resta nella sessione Pi (ADR 0001): chiudere Pi ferma la corsa, si riprende con `/auto resume`.
- Auto mode non si ferma ad aspettare l'utente: approvazioni facoltative e mai bloccanti.
- I check congelati non cambiano mai (hash, `check-manomessi`).
- Piattaforme: Linux, macOS, WSL, Windows (prototipo). Lingua UI: italiano.

## Scenari di qualità
| Scenario | Misura | Peso | Portante |
|---|---|---|---|
| Leggibilità: aperta la vista su 100×30, fase, avanzamento, salute con motivo, costo e tempo restante sono visibili senza scorrere | prova d'uso a tempo: risposta corretta a «sta procedendo? perché?» in ≤5 s | 5 | sì |
| Sicurezza della guida: ogni comando (pausa, nota, salta, riordina, modello, skill/strumenti, rifai, limiti, stop) lascia la corsa coerente e riprendibile, ed è registrato in `auto/decisioni.md` | test: comando in ogni fase + `/auto resume` → stato valido, nessun `check-manomessi`, nessun passo perso | 5 | sì |
| Leggerezza: vista aperta + corsa attiva | CPU del prototipo sul Proxmox ≤ 1/4 di Pi | 4 | sì (soglia già fissata) |
| Profondità su richiesta: da ogni riga si scende al dettaglio (output del check, tool del passo, diff del commit, testo del figlio) | ≤2 tasti dalla vista principale | 3 | no |

## Decisioni prese nell'intervista
- Guida completa: pausa/riprendi/stop; nota al prossimo passo; requisiti (saltare, riordinare, riaprire); modello per passo; forzare skill e strumenti; rifare il passo con una nota; limiti; approvazioni (facoltative); presa in mano manuale.
- Coda unica dei comandi nel supervisore, unico a scrivere lo stato: stop e «rifai passo» subito (uccidono il figlio), il resto al prossimo confine di passo; la vista mostra «in attesa: …» finché non è applicato.
- Requisito saltato: resta rosso, marcato «saltato dall'utente» con motivo in `auto/decisioni.md`; la corsa può chiudersi con esito distinto «completata con salti»; riaprirlo lo rimette in coda.
- Diario compatto per corsa (`eventi.jsonl`): per passo tool (nome, argomento breve, esito, durata), testo finale del figlio, check con coda dell'output, comandi di guida; output tagliati (~2 KB). La vista lo rilegge, anche dopo resume.
- Salute in una parola con motivo: PROCEDE, A RISCHIO (stallo 2/3, stesso errore ≥3, budget o tempo ≥80%, 4 passi build di fila senza un requisito verde), FERMA (pausa o arresto, col motivo), SERVE TE.
- Fuori dalla vista: riga di stato sempre; avvisi solo su stallo vicino, errore ripetuto, budget, fine corsa.

## Spunti adottati dalla ricerca (`10-ricerca.md`, scelta delegata dall'utente)
- Due tasti di guida: `:` nota al prossimo confine di passo, `!` steer urgente nel passo in corso (ralph-orchestrator). Lo steer urgente si salva su file e si consuma una volta sola, così sopravvive a un crash.
- Testata con «fermo da Ns» (tempo dall'ultimo evento del figlio), accorciata sotto una soglia di colonne.
- Due modi, IN DIRETTA e RIVEDI: ←/→ scorrono i passi passati; se ne arriva uno nuovo mentre rivedi, la riga di tasti lo segnala.
- Coda «serve te»: le escalation finiscono in una lista con campanello del terminale; rispondere equivale a «rifai passo con nota».
- Riga del prossimo tasto: per ogni stato della corsa la vista dice l'azione suggerita (foreman).
- Esito per passo in `eventi.jsonl` (verde al primo colpo, verde dopo n tentativi, rosso, saltato, rifatto): metriche a 0 token.
- Presa in mano manuale come pausa: `c` mette in pausa e il supervisore committa il lavoro del figlio; l'utente lavora nel worktree; `r` riprende, il supervisore confronta HEAD, registra i commit a mano in `auto/decisioni.md` e riesegue i check di tutti i requisiti.
- Tab diff del passo corrente o selezionato (claude-squad), raggiungibile in ≤2 tasti.
- Scartati per ora: commenti in linea sul diff come guida (vibe-kanban; la nota `:` basta); notifiche ntfy/Telegram (rete esterna e configurazione, da riprendere come opzione); UI web, polling a timer, database, agenti in parallelo.

## Perimetro esteso: lacune del loop (decisione utente 2026-11-11)
Lo studio copre anche le lacune di `/auto` trovate nella ricerca larga (`10-ricerca.md`), perché la vista le rende visibili e la guida le usa:
- Passaggio di consegne tra tentativi: il figlio scrive 2–3 righe in `auto/appunti.md`; l'ultima nota (≤500 caratteri) entra nel prompt del tentativo successivo sullo stesso requisito.
- Scarto dei tentativi rossi: dopo N tentativi rossi sullo stesso requisito, ritorno al commit di partenza e nuovo tentativo con la nota (N = 2, decisione 2026-11-11).
- Rilevazione di aggiramento a 0 token: regole sul diario `eventi.jsonl` (scritture su file congelati, `chmod`/`git checkout` sui check, rifiuti della policy ripetuti) che portano la salute a SERVE TE.
- Regole permanenti: una nota marcata «sempre» va in `auto/regole.md`, incluso in ogni prompt; costo fisso, quindi corto e approvato dall'utente.
- Domanda a un passo chiuso («perché hai fatto X»): solo su richiesta esplicita, perché costa token.
Vincolo: ogni aggiunta al prompt si misura in token prima di entrare (mantra 1).

## Decisioni dal territorio (`05-territorio.md`, 2026-11-11)
- Canale dati: il client legge stato JSON e `eventi.jsonl` dai file della corsa, risvegliato da `fs.watch` e da ogni evento RPC dell'auto; il percorso arriva con `setStatus`. Nessun traffico RPC per i dati.
- «Fermo da Ns»: intervallo da 1 s solo con la vista aperta e la corsa attiva, ridisegna solo la testata.
- Apertura: `/auto` senza argomenti durante una corsa, oppure `alt+a`. La vista è modale: `c`, `r`, `:`, `!` non entrano in conflitto con l'editor.
- Diario: la riga finale senza `\n` si ignora fino al prossimo evento. Campanello una volta per problema nuovo.
- `auto/regole.md`: al massimo 10 righe e 1000 caratteri. Diario illeggibile → vista con lo stato JSON e un avviso.

## Ipotesi da smontare e candidata dichiarata
- Candidata dichiarata: vista a pannelli (requisiti a sinistra, passo corrente in diretta a destra, testata con fase/passo/tempo/5h, riga di tasti in basso), aperta da `/auto` o da un tasto nel prototipo.
- Da verificare: che una vista in diretta stia nella soglia CPU con eventi frequenti del figlio.

## Riferimenti amati / odiati
Cercati (`10-ricerca.md`): ralph-orchestrator, foreman, claude-squad, vibe-kanban, omnara, agentic-tui. Da guardare ancora per la forma: k9s, lazygit, btop.

## Fuori perimetro e anti-obiettivi
- Fuori: supervisore staccato dalla sessione (daemon); vista nella UI classica; dashboard web.
- Anti-obiettivi (confermati 2026-11-11): muro di log che mostra tutto senza dire cosa conta; token spesi per la vista; comandi che mettono la corsa in attesa dell'utente senza che l'abbia chiesto; grafica appariscente (animazioni, cornici pesanti; grafica sobria).

## Decisioni già prese (ADR letti)
- ADR 0001: un processo figlio `pi -p --no-extensions` per passo nel worktree; supervisore solo codice, 0 token a riposo; mai push né merge.
