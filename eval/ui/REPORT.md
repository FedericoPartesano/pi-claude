# Fluidità della UI del terminale

Banco: `eval/ui/drive.py <etichetta> "<prompt>" <secondi> [opzioni pi]` apre Pi in un pty 160×50 (haiku), misura l'eco dei tasti (ms dal tasto al primo byte) a riposo e durante lo streaming, i byte scritti, e salva i profili CPU (`--cpu-prof`, 1 ms). `eval/ui/incl.py <cartella> <nomi…>` somma i tempi inclusivi per funzione. Prompt: 60 curiosità sul mare, 45 s di streaming. Un solo run per configurazione, WSL2: i numeri indicano l'ordine di grandezza, non un confronto fine; il testo generato varia da run a run (byte diversi), quindi il tempo CPU va letto per MB scritto.

| Configurazione | Eco tasti a riposo (ms) | Eco in streaming (ms) | KB/s | CPU occupata (s su 60) | `doRender` (s) | s di `doRender` per MB |
|---|---|---|---|---|---|---|
| `PI_UI=off` (Pi di serie) | 1–16, un picco 791 | 0–5 | 18,1 | 7,6 | 1,75 | 2,1 |
| predefinita (colonna laterale), prima | 7–107, picco 1729 | 8–22 | 7,1 | 12,0 | 5,0 | 15 |
| `PI_UI_PANEL=float` | 3–9, picco 554 | 12–46 | 18,6 | 11,3 | 3,8 | 4,4 |
| predefinita, dopo le correzioni | 5–32 | 0–43 | 24,2 | 15,3 | 8,3 | 7,5 |

## Cause trovate (dai profili)
1. **Picco all'avvio (fino a 1,7 s su un tasto):** `memory.ts` a pochi secondi dall'avvio chiamava `lookbackBatch`, che legge in modo sincrono tutte le sessioni del progetto (35 file, 31 MB), anche se l'auto-dream di oggi era già stato fatto. Ora esce prima se `.pi/memory-autodream` contiene la data di oggi. Dopo: massimo 32 ms in questa prova. Restano ~0,7 s di `spawnSync` all'avvio da `graphify.ts` (`graphifyReady`, `git`) e `ensureTool` di Pi, non toccati.
2. **`clampThinkingLines` a ogni frame:** toglieva i codici ANSI da tutte le righe di ogni messaggio a ogni frame (2,6 s inclusivi su 45 s). Ora un test su sottostringa prima dello strip: 0,9 s.

## Non risolto
- La colonna laterale costa più del Pi di serie: `renderLayoutFrame`/`compositeTuiLine` (codice di Pi) compongono ogni riga con il pannello a ogni frame (4,5 s di `paintBox` su 45 s). Per MB scritto: 7,5 s contro 2,1 di serie, 4,4 con pannello fluttuante.
- Il tetto di frame (`PI_UI_FPS`, 30) non è stato variato: da misurare.
- Le percezioni «goffo/lento» non sono ancora riprodotte come numero: l'eco dei tasti in streaming resta sotto i 50 ms in tutte le configurazioni. Da verificare dall'utente nel TUI.

## Tetto di frame (`PI_UI_FPS`) e cache della composizione
Stesso banco, un run per valore, colonna laterale attiva.

| `PI_UI_FPS` | Eco in streaming (ms) | KB/s | CPU occupata (s su 60) | `doRender` (s) | s di `doRender` per MB |
|---|---|---|---|---|---|
| 15 | 10–52 | 9,1 | 15,0 | 8,8 | 21 |
| 20 | 10–22 | 31,9 | 10,9 | 5,1 | 3,6 |
| 30 (default) | 25–48 | 39,5 | 16,5 | 9,2 | 5,3 |

Inconcludente: il run a 15 fps ha avuto un flusso di testo molto più lento (417 KB contro 1,5–1,8 MB, quindi per MB sembra il peggiore) e il rumore tra run è dello stesso ordine delle differenze. Nessun effetto chiaro del tetto; il default resta 30. Servono più run per ogni valore.

**Cache della composizione: non fattibile dall'estensione.** `compositeTuiLine`, `paintBox` e `renderLayoutFrame` sono funzioni interne del bundle di Pi (`chunk-4EYXVSA5.js`), non esportate: non si possono avvolgere con una cache senza modificare Pi o il suo bundle (che l'aggiornamento di Pi sovrascrive). Le leve rimaste sono lato estensione: meno frame (da misurare con più run), o un pannello che non invalida il layout a ogni frame (oggi si ricostruisce ogni 300 ms in lavoro e 2 s a riposo, `cachedPanel` in `pi-ui/index.ts`).

## Prototipo da zero sopra RPC (`prototype/rpc-chat/`)
Stesso driver (`PROG="node prototype/rpc-chat/chat.mjs" python3 eval/ui/drive.py <etichetta> "<prompt>" 45 --model haiku`), stesso prompt, 2 run. Il profilo CPU è del solo client; la CPU del processo `pi --mode rpc` (agente, senza TUI) è letta da `/proc` alla chiusura.

| Run | Eco tasti a riposo (ms) | Eco in streaming (ms) | Frame | CPU client nel profilo (ms su 59 s) | CPU processo RPC (ms) |
|---|---|---|---|---|---|
| proto | 0–2 | 0 | 472 | 287 | 3.760 |
| proto2 | 0–1 | 0–7 | 322 | non letto | 4.160 |

Confronto con Pi TUI (stessa macchina, stesso prompt, una prova per riga): eco 8–48 ms in streaming; CPU occupata del solo processo Pi 12–16 s con la colonna laterale (7,6 s con `PI_UI=off`), di cui `doRender` 5–9 s.

Letture e limiti, senza trarne di più:
- Il costo di disegno del client è ~0,3 s su 59 s (profilo), due ordini di grandezza sotto `doRender` di Pi (5–9 s) e l'eco dei tasti è ≈1 ms.
- Il confronto **non è a parità di funzioni**: il prototipo non ha Markdown, pannello, passi compatti, cursore, scorrimento, mouse, immagini; con le stesse funzioni il costo salirebbe di un fattore non misurato.
- I byte scritti differiscono tra run (225–350 KB contro 0,8–1,8 MB in Pi TUI) perché haiku ha speso quasi tutto in pensiero (nel TUI predefinito il pensiero è nascosto/ridotto): per MB scritto i numeri non sono confrontabili. Serve un prompt senza pensiero o un carico fisso (output registrato) per un confronto onesto.
- `clientMs` in `result-proto*.cpu.json` (≈5,3 s) include l'avvio di Node e il costo del profiler a 1 ms: non è il costo del disegno. Il profilo dice 287 ms occupati.
- Verifica funzionale: lo schermo finale (`PROTO_DUMP`) mostra pensiero a capo, riga di stato «○ idle · 589 tok out» e il prompt con i caratteri digitati durante lo streaming.

## Confronto equo: stesso carico, stesse funzioni di base
Sostituisce la sezione precedente sul prototipo (carico e funzioni non erano confrontabili).

**Carico:** provider `prototype/replay/index.ts`, nessun LLM, nessun pensiero: documento Markdown deterministico (titoli, elenchi, codice, grassetto/corsivo) trasmesso a velocità fissa. Stessa estensione per tutti i bracci. **Prototipo:** ora con Markdown, a capo ANSI, scorrimento, cursore, rotellina (verificato con `eval/ui/scroll-check.py`: 2×PagUp + rotellina → «↑55», modifica «acb»). **Misura:** `eval/ui/drive.py` con `NOPROF=1` (nessun profiler); CPU = utime+stime dell'**intero albero di processi** durante i 45 s di streaming (per il prototipo: client + agente `pi --mode rpc`); eco = tempo fino a un output che contiene il carattere digitato (caratteri rari «ΩΣπ¤§µßø», non prodotti dal flusso). Terminale pty 160×50, WSL2. Script: `eval/ui/fair/run.sh`, `run2.sh`; risultati `eval/ui/fair/*.json`.

Carico alto (2000 car/s, blocchi da 20, 3 run per braccio):

| Braccio | CPU in 45 s (s) | Eco in streaming mediana / max (ms) | Eco a riposo (ms) |
|---|---|---|---|
| Pi TUI predefinito | 49,0 / 47,1 / 48,7 | 83 / 186 | 7 |
| Pi `PI_UI_PANEL=float` | 44,8 / 46,7 / 45,5 | 70 / 249 | 3 |
| Pi `PI_UI=off` | 40,7 / 44,6 / 45,0 | 20 / 38 | 2 |
| Prototipo RPC | 14,2 / 15,6 / 18,0 | 9,5 / 38 | 0 |

Carico realistico (300 car/s, blocchi da 5 ≈ 60 eventi/s, 2 run):

| Braccio | CPU in 45 s (s) | Eco in streaming mediana / max (ms) | Eco a riposo (ms) |
|---|---|---|---|
| Pi TUI predefinito | 40,5 / 36,4 | 80 / 142 | 5 |
| Pi `PI_UI=off` | 18,1 / 16,6 | 1 / 9 | 2 |
| Prototipo RPC | 11,3 / 10,9 | 2 / 4 | 1 |

Cosa dicono i numeri (n = 2–3, un solo pty, una macchina):
- La parte grossa del costo e dell'eco lenta è **la nostra UI**, non il renderer di Pi: a carico realistico `PI_UI=off` dimezza la CPU (≈17 s contro ≈38 s) e porta l'eco da ≈80 ms a ≈1 ms, a livello del prototipo.
- Resta un divario `PI_UI=off` → prototipo (≈17 s → ≈11 s a 300 car/s; ≈43 s → ≈16 s a 2000 car/s) e il prototipo manda meno byte (0,8 MB contro 2,8 MB a 300 car/s): non è tutto il motore di Pi, il prototipo ha meno funzioni (niente immagini, caratteri larghi/IME, selezione, passi compatti, pannello, estensioni UI), quindi il divario è un limite superiore del vantaggio.
- A carico realistico la CPU del prototipo include ≈5,5–6,1 s dell'agente RPC (cumulativa dall'avvio) e ≈2,5–2,8 s del client (include l'avvio di Node).
- `PI_UI_PANEL=float` non cambia nulla di significativo a questo carico (44,8–46,7 contro 47,1–49,0 s): la colonna laterale non è la causa principale qui.
- Limiti: eco misurata fino al primo output che contiene il carattere (non il frame completo); il prototipo conta 1 colonna per carattere; carico sintetico (testo senza tool né pensiero); CPU dell'albero include i thread di Node.

Conseguenza pratica: prima di ricostruire la UI, trovare perché `pi-ui` costa ≈20 s di CPU in più a carico realistico (profilo di `PI_UI` acceso contro spento, stesso carico replay). È una correzione di giorni, non di settimane.

## Profilo `pi-ui` acceso contro spento (carico replay 300 car/s, 45 s, `--cpu-prof` 1 ms)
Una prova per configurazione (`eval/ui/fair/pf*.sh`). Tempo occupato del processo Pi (profilo):

| Configurazione | Occupato (s) | `doRender` incl. (s) | `paintBox` / `compositeTuiLine` incl. (s) |
|---|---|---|---|
| `PI_UI=off` | 13,6 | — | — |
| UI accesa, prima | 53,5 | 33,7 | 19,3 / 18,6 |
| UI accesa, dopo la correzione | 25,2 | 17,1 | 8,9 / 8,6 |

Causa trovata: `clampThinkingLines` (`pi-ui/src/thinking.ts`) era agganciato a **ogni** componente di **ogni** messaggio e scorreva tutte le righe a ogni frame, anche senza pensiero (4,9 s di tempo proprio, 11 s inclusivi con `child.render`; la lunga cronologia Markdown lo moltiplica, in più il costo di composizione cresce con il numero di righe). Correzione: il clamp si aggancia solo ai messaggi che contengono un blocco `thinking` (test aggiunto, `pi-ui/test/thinking.test.ts`).

Misura senza profiler (CPU albero di processi, stesso carico, 2 run): **24,0 / 28,1 s** contro 36,4 / 40,5 s prima (`PI_UI=off` 16,6 / 18,1 s); eco in streaming mediana ≈ 22 ms (max 61) contro ≈ 80 ms (max 142); eco a riposo 5–28 ms.

Resta: ≈ 11 s di occupato (profilo) o ≈ 8–10 s di CPU rispetto a `PI_UI=off`, quasi tutti in `paintBox`/`compositeTuiLine` (composizione della colonna laterale su tutta la cronologia, codice di Pi non esportato, vedi sopra). `PI_UI_PANEL=float` non l'ha ridotto a carico alto. Limiti: n = 1 nel profilo e 2 nelle misure senza profiler, un solo pty, carico sintetico senza pensiero né tool; un carico con pensiero vero non è stato rimisurato dopo la correzione.

## Prototipo, seconda tappa (funzioni aggiunte) e rimisura
Aggiunti: caratteri larghi, pensiero live compatto, passi dei tool con esito e durata, barra di stato con modello/contesto/costo/voci delle estensioni, widget, notifiche, bracketed paste, dialog `select`/`confirm`/`input`/`editor`. Verifica reale (Pi vero, haiku, pty): tool `bash ls` mostrato come «⚙ bash … ✓ 37ms», barra di stato con `haiku · ctx 14% · intent/caveman/memoria`; con `PI_YOLO=0` il dialog «Comando pericoloso» appare, giù+invio sceglie «No» e il modello riporta «l'utente ha rifiutato il comando». Nota: l'ambiente di questa sessione ha `PI_YOLO=1`, che spegne il dialog.

Misura a 300 car/s (2 run, stesso banco): CPU albero 9,2 / 17,8 s (prima della tappa 10,9 / 11,3 s), eco in streaming 2–10 ms, riposo 1–2 ms. La differenza tra i due run (9 contro 18 s) è rumore della macchina, non una stima: n = 2, non si conclude nulla sul costo delle funzioni aggiunte.

Ancora fuori dal prototipo: immagini (Kitty) e anteprime, selezione/copia propria, `/`-completamento e `@`-file nel prompt, pannello e colonna laterale, passi compatti raggruppati, tema, `custom()` delle estensioni (no-op in RPC: `/archivio` a schermo intero, picker, `pi-team` sidebar).

## Rimisura del prototipo con le funzioni nuove (3 run intercalati, 300 car/s, 45 s, pty 160×50)
Funzioni nuove attive: tema, riquadri, pannello laterale (git, intent, contesto), completamento, passi compatti, tabelle, grafici. `eval/ui/fair/p4*.json`, `p4.sh`.

| | CPU albero in 45 s (s) | Eco in streaming, mediana per run (ms) | Eco max (ms) | Eco a riposo (ms) |
|---|---|---|---|---|
| Prototipo | 8,6 / 9,3 / 12,1 | 2 / 3 / 3 | 3–6 | 1 |
| Pi con `pi-ui` | 28,3 / 28,0 / 26,1 | 10,5 / 22 / 14 | 43–59 | 6–8 |
| Pi `PI_UI=off` | 16,1 / 21,8 / 20,1 | 1,5 / 2 / 2 | 3–9 | 2–3 |

Lettura: le funzioni nuove non hanno alzato il costo del prototipo (prima 9–18 s a 2 run, ora 8,6–12,1 s). Il prototipo sta sotto anche a `PI_UI=off`, perché il carico della CPU di Pi comprende il rendering del suo TUI, che il prototipo non ha. Limiti: n = 3, un pty, carico sintetico senza pensiero né tool, il prototipo ha meno funzioni di `pi-ui` (niente immagini, selezione, `custom()`); i byte scritti nel pty non sono uguali tra le configurazioni (2,5 MB prototipo, 3,5 MB Pi con UI, 2,7 MB off) perché il carico è a tempo e non a byte.

## Immagini nel prototipo (kitty e sixel): peso misurato
Implementazione: `prototype/rpc-chat/chat.mjs` (`/img percorso testo` e immagini nei risultati dei tool). Kitty: PNG inviato così com'è, una sola volta (id), poi solo `a=p` e cancellazione a=d quando esce dallo schermo. Sixel: PNG decodificato con `node:zlib`, scalato alle celle, palette 3-3-2 fissa, stringa in cache per dimensione. JPEG: solo segnaposto (kitty non lo accetta, il decoder sixel è solo PNG 8 bit non interlacciato). Terminale simulato nel pty (risposte kitty/sixel e 10×20 px per cella): il disegno reale a pixel **non è verificato**, solo le sequenze emesse (`eval/ui/proto-images.py`, `proto-sixel-bench.mjs`). Sessione di 12 s con haiku, n=1 per cella.

| | CPU client (ms, intera sessione) | Byte emessi | Byte per ogni tasto dopo |
|---|---|---|---|
| Senza immagine | 148 | 1,6 KB | 46 |
| Kitty, PNG 82 KB (240×120) | 203 | 117 KB | 46–197 |
| Sixel, stesso PNG | 412 | 41 KB (4 disegni da ~7,5 KB) | 46–395 |
| Kitty, PNG 3,4 MB (1600×900, rumore) | 1374 | 4,6 MB una tantum | 197–1528 |
| Sixel, stesso PNG | 2515 | 1,8 MB (7 disegni da ~254 KB) | 46–1075 |

Encoder sixel da solo (node, 560×315): primo disegno 313 ms con decodifica (74 ms sul PNG piccolo), poi 54 ms senza cache; con la cache di stringa il ridisegno non ricodifica. Lettura: kitty paga una volta il trasferimento del file; sixel ripaga i byte a ogni ridisegno che tocca le righe dell'immagine (scorrimento, streaming sotto), quindi per immagini grosse è molto più pesante. Il costo CPU non l'ho attribuito a una parte (lettura/base64/scrittura nel pty). Limiti: n=1, sessione con LLM reale (rumore nei frame), immagine sintetica, terminale simulato.

## Rimisura dopo il lotto 1 di funzioni (suggerimenti, diff, link, send now; senza sixel)
3 run intercalati con `PI_UI=off` come controllo, 300 car/s, 45 s, pty 160×50, replay senza quota. Macchina **non libera** (load 1 min a inizio run 2,5–5,8: RabbitMQ, n8n, altri); il carico di ogni run è in `eval/ui/fair/p6-load-*`. `p6.sh`, `p6-*.json`.

| Run | Prototipo: CPU (s) / eco med (ms) / max | `PI_UI=off`: CPU (s) / eco med / max |
|---|---|---|
| 1 (load 5,8 / 4,6) | 12,4 / 3,5 / 8 | 20,3 / 2 / 5 |
| 2 (load 4,3 / 2,5) | 9,8 / 2 / 3 | 16,6 / 2 / 15 |
| 3 (load 3,0 / 2,7) | 8,9 / 2 / 3 | 16,1 / 1 / 3 |

Lettura: con carico più basso il prototipo scende a 8,9–9,8 s, come prima del lotto (8,6–12,1). Nessun peggioramento visibile dovuto alle funzioni nuove; il rumore da carico della macchina (fino a +40% sul run 1) è più grande di ogni differenza. Eco a riposo 1 ms. Limiti: n=3, macchina condivisa, carico sintetico (senza diff, link, suggerimenti né immagini: non esercitano le funzioni nuove, solo il percorso di streaming).

## Misura su macchina dedicata (Proxmox, LXC isolato)
Macchina: Intel Core 2 Duo T5470 1,6 GHz (2 core), Proxmox 9.2.2. Container LXC `301` (Debian 13, 1 vCPU fissata col cpuset al core 1, 1,5 GB RAM, nessuno swap), Node 24.15.0 e Pi 1.5.0 come sul PC; gli altri 4 container `rc-test-*` fermati per la prova. Carico: replay 300 car/s, 45 s, pty 160×50, 5 giri alternati prototipo / Pi con `pi-ui` / `PI_UI=off`, `PI_VAULT_OFF=1` (senza, il vault apre un dialog di conferma che blocca i tasti), nessuna quota usata. Script e JSON in `eval/ui/pve/` (`pb.sh`). Load a inizio run: 0,3–1,1.

| Braccio | CPU in 45 s (s), mediana dei 5 | Eco in streaming (ms), mediane per run | Eco a riposo (ms) | Byte (MB) |
|---|---|---|---|---|
| Prototipo | 8,0 (7,9–8,0) | 7,0–10,5 | 1 | 2,3–2,4 |
| Pi con `pi-ui` | 34,6 (34,5–35,0) | 34,5–50 | 17–23 | 2,0–2,1 |
| `PI_UI=off` | 24,6 (24,5–25,2) | 3–16,5 | 5–7 | 2,7 |

Lettura: le CPU sono ripetibili a ±1% tra i 5 giri (sul PC condiviso erano 8,6–12,1 s per il prototipo, 26–28 per Pi). Rapporto CPU Pi/prototipo ≈ 4,3×, `PI_UI=off`/prototipo ≈ 3,1×, Pi/off ≈ 1,4×. Su questo core lento Pi con `pi-ui` occupa ≈77% della CPU per tutto lo streaming e l'eco a riposo è 17–23 ms, contro 1 ms del prototipo. Il rapporto tra bracci coincide con quello misurato sul PC (Pi ≈ 3× prototipo). Limiti: replay sintetico (senza pensiero, tool, diff, immagini), una macchina, `PI_VAULT_OFF=1`, il costo del terminale vero non è misurato.

### Carico ricco (pensiero, `edit` con diff, link `file:riga`, suggerimenti) sul Proxmox
Provider replay con `REPLAY_MODE=rich` (`prototype/replay/index.ts`): 5 giri di pensiero (512 car) + Markdown con link `file:riga` + chiamata `edit` vera su `/tmp/rich-target.txt` (diff 40 righe tolte/40 aggiunte), poi testo finale con blocco `<!--suggerimenti-->`; 300 car/s, `PI_YOLO=1`, `PI_VAULT_OFF=1`, stesso LXC `301`, 5 giri alternati. Dati e `pr.sh` in `eval/ui/pve/rich/`. Verificato con un dump che nel prototipo compaiono pensiero ripiegato, diff con «… +N righe», link OSC 8 e suggerimenti 1-3.

| Braccio | CPU in 45 s (s) per giro | Mediana | Eco in streaming (ms, mediane) | Byte (MB) |
|---|---|---|---|---|
| Prototipo | 16,0 · 5,3 · 5,4 · 5,4 · 5,6 | 5,4 | 2–3 | 2,2–3,4 |
| Pi con `pi-ui` | 40,3 · 39,5 · 40,5 · 39,9 · 40,8 | 40,3 | 34,5–76 | 1,6 |
| `PI_UI=off` | 15,7 · 16,1 · 15,6 · 15,6 · 15,8 | 15,7 | 3–3,5 | 2,5 |

Lettura: Pi/prototipo ≈ 7,5×, `PI_UI=off`/prototipo ≈ 2,9×. Il primo giro del prototipo (16,0 s) è un'anomalia: il processo figlio `pi` ha usato 22,8 s contro 4,2–4,8 degli altri (probabile costo a freddo del file replay appena modificato; non indagato), il client è 3,4 s contro 4,1: lo scarto sta nel figlio, non nel prototipo. Resta incluso nella tabella, la mediana lo ignora. Con l'eco a 2–3 ms le funzioni nuove non costano latenza percepibile. Limiti: replay sintetico, un solo tipo di strumento (`edit`), niente immagini (misurate a parte), una macchina, stato della macchina: durante la prova le VM `rc-hub`, `rc-nodo1`, `rc-nodo2` risultavano accese (non mie), il carico a inizio giro era 0,5–1,2 (un solo giro Pi a 2,3).

Soglia fissata dall'utente: il prototipo deve restare a 1/4 della CPU di Pi. Limiti attuali: 34,6/4 = 8,6 s sul carico di testo (prototipo 8,0 s: margine ≈7%), 40,3/4 = 10,1 s sul carico ricco (5,4 s). Il carico di solo testo è il vincolo più stretto.
