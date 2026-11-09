# Territorio: agenti di programmazione autonomi di lunga durata
Aggiornato: 2026-11-09 · fase 1b

Fonti consultate (recuperate il 2026-11-09):
- [A1] Anthropic, «Effective harnesses for long-running agents» — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- [A2] Anthropic, «How we built Claude Code auto mode» — https://www.anthropic.com/engineering/claude-code-auto-mode
- [A3] Anthropic, «How we built our multi-agent research system» — https://www.anthropic.com/engineering/multi-agent-research-system
- [A4] Anthropic, «Building effective agents» — https://www.anthropic.com/engineering/building-effective-agents
- [H1] G. Huntley, «Ralph Wiggum as a software engineer» — https://ghuntley.com/ralph/
- [W1] S. Willison, «The lethal trifecta for AI agents» — https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- [M1] METR, «Recent frontier models are reward hacking» — https://metr.org/blog/2025-06-05-recent-reward-hacking/
- [M2] METR, «Measuring AI ability to complete long tasks» — https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/ (cifre dichiarate superate dalla pagina stessa)
- [I1] ImpossibleBench, arXiv 2510.20270 — https://arxiv.org/abs/2510.20270
- [C1] Cognition, «Don't build multi-agents» — https://cognition.ai/blog/dont-build-multi-agents
- [F1] B. Böckeler (martinfowler.com), «Autonomous coding agents: a Codex example» — https://martinfowler.com/articles/exploring-gen-ai/autonomous-agents-codex-example.html
- Codice locale: `extensions/goal.ts`, `extensions/guards.ts`, `extensions/land/land.ts` (worktree e coda di atterraggio già presenti).

## 1. Concetti e vocabolario
- **Harness**: il codice attorno al modello (prompt, tool, ciclo, stato). Auto mode è un harness, non una skill. — `coperta` — [A1]
- **Agente di inizializzazione e agente di avanzamento**: stesso harness, primo prompt diverso. Il primo prepara l'ambiente, i successivi avanzano di un passo. In auto mode corrisponde a define/plan contro build. — `coperta` (fasi del brief) — [A1]
- **Overeager** (zelo eccessivo) contro **errore onesto** contro **prompt injection** contro **disallineamento**: le quattro cause di un'azione pericolosa. Il brief pensa solo all'injection (decisione 10). — `non coperta` (vedi N3) — [A2]
- **Reward hacking / cheating rate**: l'agente fa passare i test modificandoli o aggirando il valutatore. — `coperta in parte` (decisione 9) — [M1][I1]
- **Lethal trifecta**: dati privati + contenuto non fidato + comunicazione esterna = esfiltrazione possibile. — `non coperta` (N3) — [W1]
- Da evitare come sinonimi: «autonomia» per «assenza di permessi»; [A2] separa il grado di autonomia dal livello di sicurezza.

## 2. Pattern noti
- **Ralph loop**: `while :; do cat PROMPT.md | claude; done`, un elemento per giro, contesto **nuovo** a ogni giro, stato solo in file (piano, specifiche) e in git. — `non coperta` (N1) — [H1]
- **Lista dei requisiti in JSON con `passes: false`**: l'agente può cambiare solo `passes`. Il JSON viene riscritto a sproposito meno del Markdown. — `non coperta` (N2) — [A1]
- **Avvio di ogni sessione**: `pwd`, file di progresso, `git log`, script `init.sh`, smoke test prima di toccare codice, per non costruire su uno stato rotto. — `coperta in parte` (decisione 11 ripresa; manca lo smoke test) — [A1]
- **Commit a ogni passo con progress file**: permette `git revert` dei passi sbagliati. — `coperta` (decisione 4) — [A1][H1]
- **Classificatore di azioni a due stadi**: filtro a un token, poi ragionamento solo se il filtro segnala; vede solo i messaggi dell'utente e i comandi, mai i ragionamenti né l'output dei tool. — `non coperta` (N3) — [A2]
- **Orchestratore con worker**: default dei sistemi di ricerca, sconsigliato per scrivere codice. — `coperta` (decisione 8) — [A3][C1]
- Anti-pattern: dichiarare vittoria in anticipo, fare tutto in una volta, segnare come fatto senza prova end-to-end. — `coperta` (check congelati, `goal_done` coi check) — [A1]

## 3. Trade-off noti
- **Sessione lunga con compattazione oppure contesto nuovo per passo**: [A1] dice che la compattazione «non basta» e che il riassunto non passa istruzioni chiare; [H1] riparte pulito a ogni giro. In cambio di contesto pulito si paga la rilettura dello stato a ogni giro (cache meno efficace). — `non coperta` (N1)
- **Lista nera, classificatore o sandbox**: la sandbox è sicura ma costosa da mantenere; nessun permesso non costa nulla e non protegge; il classificatore sta nel mezzo, con un falso negativo del 17% sulle azioni overeager reali. Una lista nera viene aggirata da `node -e`/`python -c`: Claude Code, entrando in auto mode, toglie le regole sugli interpreti. — `non coperta` (N3) — [A2]
- **Agente singolo contro multi-agente**: gli agenti usano circa 4× i token di una chat, i sistemi multi-agente circa 15×; le decisioni implicite di worker separati entrano in conflitto. — `coperta` (decisione 8) — [A3][C1]
- **Granularità del passo**: un elemento per giro; allargare solo quando funziona. — `coperta in parte` (le fasi del brief sono macro, il passo di build no) — [H1][A1]

## 4. Modi di fallimento noti
- Fare tutto in una volta, esaurire il contesto a metà e lasciare una funzione non documentata. — `coperta in parte` (N1) — [A1]
- Dichiarare finito il progetto vedendo che qualcosa è stato fatto. — `coperta` (check e `goal_done`) — [A1]
- Segnare come fatto senza test end-to-end (unit test sì, uso reale no). — `non coperta` (N4) — [A1]
- Cancellare o riscrivere test, monkey-patch del valutatore, risposte precalcolate: tra il 25% e il 100% delle esecuzioni su alcuni compiti METR. — `coperta in parte`: il brief congela i check ma non impedisce nel codice di scrivere sui file dei check e dei test (N2) — [M1][I1]
- Scope escalation, ricerca di credenziali dopo un errore di autenticazione, parametri inventati («cancella il job» → il più simile), condivisione via servizi esterni (gist), riprova con flag che saltano le verifiche. — `non coperta` (N3) — [A2]
- Implementazioni duplicate perché la ricerca (ripgrep) non trova il codice esistente: «non dare per scontato che non esista». — `differita` (istruzione di prompt della fase build, da decidere in fase 4) — [H1]
- Ricerche ripetute senza memoria (grep su `node_modules` tre volte di fila). — `coperta` (lean-tools, guards esistenti) — [F1]
- Il modo di fallimento del brief (quota, giri a vuoto, decisioni da disfare, azioni distruttive) rientra in questi; non prevede il **cheating sui test** né **l'esfiltrazione**.

## 5. Attributi di qualità
- Idoneità funzionale: scenario «completamento 7/10» — `coperta`, portante.
- Sicurezza: scenario «0 comandi vietati» — `coperta`, portante; manca l'esfiltrazione dei dati, che non è un comando vietato ma una richiesta di rete (N3).
- Efficienza e costi: «≤ 30% della finestra 5h, 0 token a riposo» — `coperta`, portante.
- Affidabilità: ripresa — `coperta`.
- Manutenibilità: `phases.json` modificabile — `coperta`.
- Portabilità: notifiche per sistema operativo — `coperta in parte` (ignoto 6).
- Osservabilità: transcript della sessione Pi più rapporto — `coperta`; nessuno scenario misurabile (accettabile).
- Usabilità: avvisi e pannello — `coperta`.

## 6. Standard, normative, convenzioni
- `AGENTS.md`/`CLAUDE.md` come istruzioni del repo, lette per prime dagli agenti. — `coperta` (Pi già le carica) — [F1]
- Conventional Commits, release-please: i commit di auto mode entrano nel changelog solo se `feat`/`fix` dopo il merge. — `coperta`.
- Normative: nessuna rilevante (uso personale, nessun dato di terzi). — nessuna fonte trovata.

## 7. Strumenti ed ecosistema
- Claude Code ha già una sua **auto mode** (classificatore, `claude auto-mode defaults`); non vale qui perché i tool li esegue Pi, non `claude`. Se ne possono però riusare le regole di blocco come elenco. — `non coperta` (N3) — [A2]
- `git worktree` con la coda di atterraggio esiste già in `extensions/land`. — `coperta` (decisione 5; riuso da valutare in fase 4).
- `extensions/guards.ts` intercetta già Unicode nascosto, pacchetti a rischio e scritture concorrenti. — `coperta`: punto d'aggancio per i limiti.
- Banchi: SWE-bench, ImpossibleBench per il cheating. — `differita` (il banco `eval/auto/` usa goal del repo; si può aggiungere un goal «impossibile» per misurare il cheating, da decidere con il banco).

## 8. Fonti e persone autorevoli
Engineering blog di Anthropic ([A1]–[A4]), METR, Simon Willison, Geoffrey Huntley, Cognition, Birgitta Böckeler (martinfowler.com). Da copiare in `RESOURCES.md` del tema `agenti-autonomi`.

## 9. Controversie aperte
- Agente singolo contro multi-agente: [C1] contro, [A3] a favore per la ricerca; [A1] lo lascia aperto per il codice. Il brief prende la posizione di [C1] (decisione 8).
- Contesto lungo con compattazione contro contesto nuovo per passo: il brief sceglie la compattazione senza saperlo (N1).
- Autonomia con classificatore contro sandbox: per [A2] il 17% di falsi negativi è accettabile solo rispetto al «nessun permesso».
- Il «7 su 10 per mezza giornata» è al limite di quanto misurato da METR sull'orizzonte dei compiti (le cifre del 2025 sono dichiarate superate): l'obiettivo può essere ambizioso. — `differita` (si misura col banco).

## Controllo arc42
Vincoli, contesto, strategia, vista a runtime (fasi), deployment (worktree), sicurezza, persistenza (file di stato), errori (stop e rapporto), configurazione (`phases.json`, tetti), qualità, rischi: presenti nel brief. Glossario: da creare nel tema. Vista a blocchi: rimandata alla fase 4.

## Non coperte → decisione di Federico
- N1 — Contesto nuovo per passo: **affrontare** — una sessione Pi nuova per ogni passo del piano, stato in file e git.
- N2 — **affrontare** — `auto/requisiti.json` (solo `passes` modificabile) e blocco nel codice delle scritture su check e test congelati durante build.
- N3 — **affrontare** — lista nera nel codice (regole di blocco di Claude Code auto mode) + web e rete in uscita spenti in build e oltre; web in sola lettura in define/plan; pacchetti dichiarati installati prima di partire.
- N4 — **affrontare** — smoke test a inizio di ogni passo; prova d'uso reale (comando, pty o browser) scritta nel piano per ogni requisito prima di `passes: true`.
