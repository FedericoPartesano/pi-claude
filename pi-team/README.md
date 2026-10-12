# pi-team

Team di sub-agenti specializzati guidato dal manager (la sessione Pi principale).
Il modello scrive il piano; il codice garantisce checkpoint, verifica empirica, tentativi e budget.

## Uso
```bash
pi-full                          # già caricato
pi -e ~/documents/projects/pi-claude/pi-team
```
Chiedi un lavoro in più parti ("usa il team per …"). Il manager chiama il tool `team` con un piano:
ti viene chiesto di approvarlo, poi il team lavora e restituisce un report verificato.

## Come funziona
1. **Piano** (dal modello): compiti con ruolo, dipendenze, `files` e comandi di verifica; validato dal codice:
   ruoli esistenti, niente cicli, almeno 2 compiti e al massimo 12, istruzioni autosufficienti (≥30 caratteri),
   chi modifica file deve dichiarare verifica e `files`.
2. **Checkpoint**: approvazione dell'utente (`PI_TEAM_AUTO_APPROVE=1` per esecuzioni automatiche).
3. **Esecuzione**: ogni agente è un processo `pi` (provider claude-code) con modello, tool e istruzioni del ruolo;
   niente ondate: ogni compito parte appena le sue dipendenze sono finite e i suoi `files` sono liberi (un compito
   tiene i suoi file per tutta la durata, tentativi compresi). Parallelismo aggressivo dalla finestra 5h dell'abbonamento,
   riletto a ogni passo: <80% → 8, <90% → 3, <95% → 1, oltre o extra usage → non parte (`PI_PARALLEL_MAX=N` cambia il tetto).
4. **Verifica**: i comandi li esegue il codice appena l'agente finisce. Se un controllo fallisce mentre altri agenti
   stanno modificando file, viene ripetuto quando si fermano (nel frattempo non partono nuove modifiche) e conta
   solo quel risultato; se fallisce davvero il compito torna all'agente con l'errore (max 3).
   Verifica finale con giri correttivi (max 2), poi il revisore. **Decidono i test**: il report è VERIFICATO
   solo se i controlli finali passano.

## Pi da solo, in parallelo (tool `parallel`)
Per le parti indipendenti di un lavoro (un modulo ciascuna, frontend e backend, codice e documentazione, più indagini)
Pi lancia subito più agenti insieme, con gli stessi ruoli e specialisti del team ma senza piano da approvare,
senza controllo iniziale, revisore e giri correttivi. Chi modifica file deve dichiarare `files` disgiunti dagli altri
(il codice rifiuta la richiesta prima di partire) e un comando `verify`, che gira appena l'agente finisce; un fallimento
torna all'agente una volta con l'errore. Il report dice cosa ha fatto ciascuno; l'integrazione la fa Pi.

**Costano più di Pi da solo, e sono l'eccezione.** Misurato sui casi di eval: gli agenti spendono 2–6 volte i token di
Pi da solo e non sono più veloci (ognuno riparte da zero, rilegge e scrive un report; il manager pianifica e legge
tutto). In `pi-full` quindi `team` e `parallel` sono spenti: niente descrizioni in ogni richiesta; Pi li carica con
`load_tools` (o tu con `/tools team parallel`) solo per lavori grandi.

## Contratti, dipendenze, note e lezioni
- **Contratti** (`contracts` nel piano del `team`): quando un compito usa codice di un altro, il manager scrive prima
  le interfacce (export, firme, formati); ogni agente le riceve e non deve indovinarle né aspettare i file altrui.
  Su tl02 (compiti dipendenti) costo pesato −18%, in media −8%: l'unica variante misurata che fa risparmiare.
  Provati e tolti perché costavano di più: contesto del progetto condiviso negli agenti (+12–16%), domande tra
  agenti (1 in 6 esecuzioni), partenza scaglionata per riusare la cache (+6%, tempo quasi doppio).
- **Dipendenze**: un agente riceve per intero i "## Risultati" dei compiti da cui dipende.
- **Note condivise** (`$TMPDIR/pi-team/notes-*.md`, fuori dal progetto): il codice ci scrive i risultati di ogni
  compito finito; ogni agente sa dov'è, la legge se serve e può aggiungere scoperte (`echo … >>`).
- **Lezioni** (`~/.pi/agent/team/lessons/<progetto>-<hash>.jsonl`), ricavate dal codice senza modelli a fine lavoro:
  controlli falliti al primo tentativo, compiti mai completati, budget di token superato, controlli già rotti prima
  del team (la lezione sparisce quando tornano a passare), richieste del revisore, file cambiati fuori dai `files`.
  Entrano nel prompt degli agenti e, quando l'utente chiede il team, nel contesto del manager che pianifica.

## Guardie sul manager
- Se la richiesta dice "usa il team", il manager non può modificare file prima di chiamare il tool
  (la guardia si toglie se il team rifiuta il piano perché troppo piccolo, se non può partire o se l'utente rifiuta il piano).
- Dopo un report riuscito, rieseguire gli stessi comandi di verifica è bloccato finché non cambia un file.

## Visibilità
Il tool pubblica una **board** (`details.board`: fase, stato/tentativi/errore/token di ogni compito, controlli finali,
revisione) a ogni transizione. pi-desk la mostra come card sotto il passo `team`; nel terminale è il testo
dell'aggiornamento e il footer (`team 3/6 ✗1 · t4 implementer (2° tentativo)`). Nelle sessioni riaperte
la card non c'è (il transcript conserva solo il testo del report).

**Vista degli agenti: `/agents` o `ctrl+alt+a`.** Si apre sopra la chat, anche mentre il team o `parallel` lavorano,
senza aggiungere nulla alla conversazione. Mostra una scheda per agente: compito, modello, token in/out,
richieste, tempo, tentativo, il ragionamento in streaming, gli strumenti chiamati con l'output, e cosa sta
facendo adesso. Le schede si dispongono in colonne, con una seconda riga se c'è spazio.
- Tasti: `←→`/`↑↓` scegli l'agente, `Invio` ingrandisci, `f` mostra solo gli attivi, `Esc` chiudi.
- Nella scheda ingrandita trovi l'output completo con barra di scorrimento (`↑↓`, `PgUp/PgDn`, `End` per
  seguire) e un pannello di statistiche: strumenti per numero d'uso e contesto per richiesta (sparkline).
- Il footer ricorda la scorciatoia.

I dati arrivano dagli eventi JSON dei figli (`src/feed.ts`, con un limite di 120 voci per agente). Il disegno
sta in `src/view/`: `widgets.ts` (cornici, tasti, sparkline, scrollbar), `agent-card.ts` e `agents-view.ts`.
I colori seguono `/theme`. In pi-desk per ora c'è solo la card della board.

## Ruoli (`roles/*.md`, override in `~/.pi/agent/team/roles/`)
| Ruolo | Modello | Tool | Scrive |
|---|---|---|---|
| scout | haiku | read, bash | no |
| implementer | sonnet | read, bash, edit, write | sì |
| tester | sonnet | read, bash, edit, write | sì |
| reviewer | sonnet | read, bash | no |
| analyst | sonnet (thinking alto) | read, bash | no |
| debugger | sonnet (thinking alto) | read, bash, edit, write | sì |
| documenter | sonnet | read, bash, edit, write | sì |

`analyst` per analisi che chiedono ragionamento (architettura, cause, opzioni); `debugger` riproduce il bug
e corregge la causa; `documenter` scrive documentazione verificata sul codice.

### Specialisti
Un ruolo con `extends: <ruolo>` eredita i campi che non imposta (modello, tool, budget, `writes`) e le regole del ruolo
base, a cui aggiunge solo le competenze. `stack:` elenca le dipendenze che lo rendono adatto (`@scope/*` ammesso).

| Specialista | Base | Stack |
|---|---|---|
| react-dev | implementer | react, react-dom, react-router… |
| electron-dev | implementer | electron, electron-builder, electron-forge… |
| nest-dev | implementer | @nestjs/* |
| express-dev | implementer | express, express-validator… |

Le competenze dei quattro specialisti sono verificate sulla documentazione ufficiale della versione corrente
(Electron 44.7, React 19.3, NestJS 12.1, Express 5.3; ottobre 2026), divise per major dove le regole cambiano
(es. errori asincroni in Express 4 e 5). Ogni file ha due campi che l'agente non riceve:
`sources:` (le pagine ufficiali usate) e `verified:` (data e versioni). Le poche regole non ufficiali sono segnate come tali.
Quando esce una major, rileggi le breaking changes e aggiorna regole e `verified:`.

Quando chiedi il team, il codice legge i `package.json` del progetto (radice, cartelle di primo livello,
`apps/*`, `packages/*`…) e dice al manager quali specialisti usare e dove (es. `react-dev: react@^19.1.0 in frontend/`): il manager riporta la versione nel compito.

### Il team cresce
Se il progetto usa uno stack noto senza specialista (Vue, Angular, Svelte, Next.js, Fastify, Prisma, Playwright…),
il manager lo sa e può aggiungere il membro nel piano con `newRoles` (nome, ruolo base, stack, competenze).
Il nuovo membro compare nel piano da approvare; se approvi, è salvato in `~/.pi/agent/team/roles/<nome>.md`
(con `origin: aggiunto dal team il …`) e resta nel team per i lavori successivi. Puoi modificarlo o cancellarlo;
i file esistenti non vengono mai sovrascritti. Al massimo 3 nuovi membri per piano.

`/team-members` mostra tutti i membri, con ★ quelli adatti al progetto corrente e gli stack ancora scoperti.

## Test
`npm test` (unitari, runner e verifiche finti) · `npx tsc -p .` · valutazione empirica: `../eval/team-cases.mjs` e `../eval/team-large-cases.mjs`.

## Consigliere: Pi da solo o team?
In `pi-full`, prima di ogni richiesta, un punteggio locale istantaneo (nessuna chiamata al modello) valuta il lavoro:
parti distinte (elenchi, anche numerati sulla stessa riga), aree o moduli toccati, parole da lavoro ampio
("migrazione", "tutto il progetto"…), richiesta di revisione indipendente, contesto della sessione già pieno;
penalità per richieste brevi e per le domande.
- Sotto la soglia (5): nessuna interruzione, Pi da solo.
- Sopra la soglia: domanda "Usare il team?" con punteggio e motivi. Sì → il messaggio diventa "Usa il tool team…"; No → Pi da solo.
- `/advise <lavoro>` mostra la valutazione senza eseguire nulla.

Taratura prudente: i 6 lavori compositi della valutazione (dove il team non ha reso) risultano "Pi da solo" (test).
