# Territorio: monitor e guida di un agente di coding autonomo da terminale
Aggiornato: 2026-11-11 · fase 1b chiusa

Fonti consultate (2026-11-11):
- Ricerca esterna di questo studio, `10-ricerca.md`. Comprende ralph-orchestrator, foreman, claude-squad, vibe-kanban, omnara, agentic-tui, continuous-claude, ralphex, gastown, smart-ralph e ralph-loop-agent. Comprende anche gli articoli di Anthropic («Effective harnesses for long-running agents»), di OpenAI (monitoraggio degli agenti interni) e di detail.dev, più le discussioni HN 46081704 e 50284255.
- Documentazione di Pi: `docs/rpc.md` e `docs/rpc-extension-ui.md`. In RPC i canali verso il client sono solo `notify`, `setStatus`, `setWidget`, `setTitle` e `set_editor_text`, più i dialog.
- Codice locale:
  - `prototype/rpc-chat/chat.mjs`: 1313 righe, gestione dei tasti alle righe 1236–1295, `dialogKey` prima dell'editor, heartbeat a 1 s solo con `running`;
  - `extensions/auto.ts` e `extensions/auto/{loop,child,state}.ts`;
  - ADR 0001.

## 1. Concetti e vocabolario
- Passo, tentativo, requisito, corsa e fase sono distinti nel codice (`loop.ts`) e nel brief. Il brief usa «passo» per il figlio e «tentativo» per un passo ripetuto sullo stesso requisito. Nel glossario va evitato «iterazione», il termine di Ralph, che fonde i due concetti — `coperta` — loop.ts, brief.
- Nota (al confine del passo) e steer (nel passo in corso) sono comandi diversi, con tempi diversi — `coperta` — ralph-orchestrator `input.rs`, brief.
- Stato (lo scrive il supervisore) e diario (`eventi.jsonl`, solo in aggiunta) vanno distinti: lo stato si sovrascrive, il diario mai. Nel brief la distinzione è implicita — `coperta` — brief, round 4.
- Le parole della salute (PROCEDE, A RISCHIO, FERMA, SERVE TE) e l'esito del passo (verde al primo colpo, verde dopo n tentativi, rosso, saltato, rifatto) sono due assi separati — `coperta` — foreman `PHASE_HINT`, brief.

## 2. Pattern noti
- Ralph loop: un figlio senza memoria per ogni passo, git e file come memoria. È il default della comunità dal 2025 — `coperta` — ADR 0001.
- File di passaggio di consegne curato, contro il diario prolisso — `coperta` (perimetro esteso) — continuous-claude, Anthropic.
- Steer persistito su file e consumato una volta sola — `coperta` — ralph `urgent_steer.rs`.
- Vista che rilegge un registro in sola aggiunta (event sourcing leggero): la vista si ricostruisce dopo un crash o un resume — `coperta` — brief, round 4.
- Pausa come «presa in mano», con commit prima e riconciliazione dopo — `coperta` — claude-squad.
- Anti-pattern: riassunti di stato prodotti dal modello (8–16% dei token, HN 50284255); approvazioni bloccanti nei loop lunghi; QA come agente separato che oscilla — `coperta` (anti-obiettivi, approvazioni non bloccanti, review unica).
- Canale dati tra supervisore e vista. In RPC Pi non ha eventi personalizzati per le estensioni: si può usare `setWidget` con righe di testo, oppure il client legge i file della corsa. La scelta non è fatta — `non coperta` — `docs/rpc-extension-ui.md`.

## 3. Trade-off noti
- Vista in diretta contro CPU. Ogni evento del figlio può forzare un ridisegno; il margine sul carico di testo è ≈7% — `coperta` (scenario portante, Proxmox).
- «Fermo da Ns» contro il vincolo «niente timer». Il contatore deve avanzare anche senza eventi. Oggi l'heartbeat del prototipo gira solo con `running`, che riguarda il turno principale e non la corsa `/auto`, che va in background. Il brief chiede il contatore ma vieta i timer — `non coperta` — `chat.mjs:1304`.
- Granularità del diario contro dimensione: tool con argomento corto, output tagliato a ~2 KB. La rotazione non è decisa — `differita` (già in `90-ignoto.md`: si fissa dopo una corsa vera misurata).
- Note iniettate nel prompt contro cache: ogni testo nuovo prima del requisito rompe il prefisso in cache del figlio. Il figlio però parte comunque da zero per ogni passo, quindi la cache vale solo dentro il passo — `coperta` in parte. La posizione della nota nel prompt (in coda) va fissata nel design.

## 4. Modi di fallimento noti
- Muro di log: la vista mostra tutto e niente — `coperta` (anti-obiettivo, salute con motivo).
- Vista vecchia dopo un resume o un crash — `coperta` (il diario si rilegge).
- Righe del diario lette a metà mentre il supervisore scrive: un JSON troncato in coda manda in errore il parser del client — `non coperta`.
- Allarmi a raffica: il campanello per ogni escalation, ripetuto a ogni ridisegno o a ogni passo dello stesso problema — `non coperta`.
- Due sessioni Pi sulla stessa corsa: la guardia «già in corso» (`auto.ts:236`) vale solo dentro un processo. Due supervisori sullo stesso worktree e lo stesso stato si corrompono a vicenda — `non coperta`.
- Comando applicato due volte, per esempio uno steer riletto dopo un crash — `coperta` (consumo singolo).
- L'agente aggira check o policy pur di arrivare al verde — `coperta` (perimetro esteso, rilevazione a 0 token).
- Memoria che diventa culto: le regole permanenti crescono e un workaround diventa legge — `coperta` in parte (approvate dall'utente e corte). Manca un tetto esplicito — `non coperta`, minore.

## 5. Attributi di qualità
- Usabilità e leggibilità: peso 5, portante, scenario misurabile — `coperta`.
- Affidabilità della guida: peso 5, portante — `coperta`.
- Efficienza: CPU con peso 4 e portante; token a 0 per la vista — `coperta`.
- Portabilità: Linux, macOS, WSL e Windows sono nel brief. La lettura dei file della corsa con `fs.watch`, se si sceglie, ha differenze note tra piattaforme (eventi doppi, rename) — `non coperta` (dipende dal canale dati).
- Sicurezza: il diario salva argomenti e output dei tool, che possono contenere segreti (token in variabili d'ambiente, `.env` letti). Il brief non dice dove sta il diario né se entra in git — `non coperta`.
- Manutenibilità e testabilità: il Pi finto e il pty bastano per provare la vista con un diario sintetico — `coperta` (pratica del progetto).
- Accessibilità: la salute è una parola, non solo un colore — `coperta`.

## 6. Standard, normative, convenzioni
- Sequenze del terminale: campanello `BEL` (`\x07`), schermo alternativo già in uso. Nessuno standard nuovo — `coperta`.
- Licenze: claude-squad è AGPL, quindi solo idee e niente codice; gli altri riferimenti sono MIT o Apache — `coperta` (`10-ricerca.md`).
- Nessun vincolo normativo — `nessuna fonte trovata` che ne indichi.

## 7. Strumenti ed ecosistema
- La piattaforma ha già: `setWidget` e `setStatus` in RPC (usati dal pannello AUTO); i comandi `/auto …` via `prompt`, eseguiti anche durante un turno, come provato con `/now`; i dialog `select`/`confirm`/`input` — `coperta`.
- Tasti nel prototipo: `dialogKey` cattura i tasti prima dell'editor, quindi in una vista modale le lettere (`c`, `r`, `:`, `!`) sono libere. Fuori dalla vista sono già usati `alt+n`, `alt+v` e `alt+s` (quest'ultimo non va riassegnato). Il conflitto sul tasto `c` sparisce se la vista è modale; resta da scegliere il tasto che apre la vista — `non coperta`.
- Forme di TUI di riferimento non ancora guardate: k9s, lazygit, btop — `differita` (servono per la forma, non per l'architettura: fase 3).

## 8. Fonti e persone autorevoli
- Articolo di Anthropic sui loop di lunga durata, README di ralph-orchestrator e Gas Town (Steve Yegge), post di Geoffrey Huntley su Ralph (citato da humanlayer) — `coperta` (`10-ricerca.md`).
- Nessun radar periodico specifico del dominio — `nessuna fonte trovata`.

## 9. Controversie aperte
- Monitor deterministico contro monitor fatto da un LLM. OpenAI usa un modello che classifica la gravità; il brief sceglie regole a 0 token. È una posizione presa consapevolmente — `coperta`.
- Approvazioni bloccanti contro flusso continuo. ralphex e foreman si fermano, il brief non si ferma mai — `coperta`.
- TUI contro web. La maggioranza dei progetti recenti (vibe-kanban, omnara, agentic-tui) va sul web, il brief sulla TUI — `coperta`.
- Agenti in parallelo: è la moda (Gas Town, multi-agent-shogun), ma xr0am mostra che il costo vero sono le collisioni. Il brief lo esclude — `coperta`.

## Controllo arc42
- Vincoli, contesto, strategia, requisiti di qualità e glossario: `coperta`.
- Vista a blocchi (supervisore, diario, client, coda comandi): `coperta` nel brief a parole; il disegno è in fase 3.
- Vista a runtime: la sequenza «comando dalla vista → coda → confine di passo → diario → vista» non è scritta — `coperta` in parte (fase 3).
- Deployment: tutto locale, un processo Pi più il client — `coperta`.
- Concetti trasversali:
  - persistenza: `coperta`;
  - errori, cioè cosa mostra la vista se il diario è illeggibile o manca: `non coperta`, minore;
  - configurazione (soglie e limiti in `LIMITS`): `coperta`.
- Rischi: il margine di CPU è il rischio principale — `coperta` (scenario portante).

## Non coperte → decisione di Federico
| # | Voce | Decisione |
|---|---|---|
| 1 | Canale dati supervisore → vista (§2, §5 portabilità) | affrontare: file della corsa (stato JSON + `eventi.jsonl`) letti dal client, risvegliato da `fs.watch`; percorso annunciato con `setStatus`; rilettura anche a ogni evento RPC dell'auto per coprire le differenze di `fs.watch` |
| 2 | «Fermo da Ns» senza timer (§3) | affrontare: intervallo da 1 s solo con la vista aperta e la corsa attiva, ridisegna solo la testata; nessun timer fuori dalla vista |
| 3 | Righe del diario lette a metà (§4) | affrontare: la riga finale senza `\n` si ignora fino all'evento successivo |
| 4 | Campanello a raffica (§4) | affrontare: una volta per problema nuovo (chiave motivo + requisito) |
| 5 | Due sessioni Pi sulla stessa corsa (§4) | differita (proposta lock con pid non accettata; da discutere) |
| 6 | Segreti nel diario e sua posizione (§5) | differita (proposta diario fuori da git con maschera dei segreti non accettata; da discutere) |
| 7 | Tasto che apre la vista (§7) | affrontare: `/auto` senza argomenti durante una corsa, più `alt+a`; dentro la vista modale le lettere sono libere |
| 8 | Tetto alle regole permanenti (§4) e vista con diario illeggibile (arc42) | affrontare: `auto/regole.md` al massimo 10 righe e 1000 caratteri; diario mancante o illeggibile → la vista mostra lo stato JSON con un avviso |
