# Lean tools: risultati

Data: 2026-10-08 · Spec: `docs/specs/2026-10-08-lean-tools-design.md` · Codice: `extensions/lean-tools.ts`, `extensions/lean/*.ts`

## TL;DR

- **Affidabilità invariata ovunque.** In nessun esperimento online cambia l'esito di un caso: 50/50 e 50/50 sui casi del primo giro, 30/30 e 30/30 sulle domande su `marked`.
- **Sull'output grande il risparmio è enorme (offline).** `search` usa l'89% di token in meno di `grep -rn` e il 53% in meno del grep di Pi. Gli output di bash si riducono dell'85% rispetto a quello che Pi passa oggi, senza perdere informazioni chiave; in un caso ne recuperano una che il troncamento di Pi perdeva.
- **Sul lavoro reale il guadagno è piccolo.** Con la configurazione a costo fisso zero il primo giro usa il 3,6% di token in input in meno (shell −16%, casi limite −25%). Sulle domande mirate in un repo grande non cambia niente. Il modello lancia comandi già mirati e gli output grandi capitano di rado. L'obiettivo della spec (−15%) **non è raggiunto**.
- **I tool nuovi non si ripagano.** `search` e `outline` costano +368 token a ogni richiesta e il modello li usa poco: `search` 1 volta in 50 casi, `outline` 2 volte in 20. Con loro accesi il primo giro costa il 4,7% in più. Restano disponibili ma spenti (`PI_LEAN_SEARCH=1`, `PI_LEAN_OUTLINE=1`).
- **Decisione: accesi di default solo i pezzi a costo fisso zero.** Sono le riletture invariate, la compattazione dell'output di bash e il raggruppamento senza perdite dell'output di `grep`/`rg`: non hanno mai peggiorato un caso e risparmiano dove l'output è grande.

## E1: ricerca (offline, 24 ricerche reali su yaml, marked e questo repo)

Token stimati (caratteri / 3,6) e presenza del file atteso nell'output.

| repo | ricerca | grep -rn | grep di Pi | search | trovato (grep/Pi/search) |
|---|---|---|---|---|---|
| yaml | `anchor` | 5305 | 2062 | 1321 | ✓/✓/✓ |
| yaml | `resolveFlowCollection` | 81 | 81 | 72 | ✓/✓/✓ |
| yaml | `lineWidth` | 1829 | 1829 | 803 | ✓/✓/✓ |
| yaml | `KEY_OVER_1024_CHARS` | 158 | 158 | 142 | ✓/✓/✓ |
| yaml | `class Lexer` | 11 | 10 | 11 | ✓/✓/✓ |
| yaml | `toJS\(` | 3085 | 2091 | 1216 | ✓/✗/✓ |
| yaml | `sortMapEntries` | 559 | 559 | 297 | ✓/✓/✓ |
| marked | `walkTokens` | 2350 | 2350 | 861 | ✓/✓/✓ |
| marked | `blockquote` | 9911 | 2250 | 1603 | ✓/✓/✓ |
| marked | `escape\(` | 39 | 39 | 39 | ✓/✓/✓ |
| marked | `class _Lexer` | 24 | 24 | 24 | ✓/✓/✓ |
| marked | `TODO` | 16 | 16 | 16 | ✓/✓/✓ |
| marked | `heading` | 7634 | 2231 | 1590 | ✓/✓/✓ |
| marked | `hooks` | 2490 | 2101 | 905 | ✓/✓/✓ |
| pi | `registerTool` | 3210 | 385 | 279 | ✓/✓/✓ |
| pi | `isUsingOverage` | 91171 | 11286 | 3304 | ✓/✓/✓ |
| pi | `parseProposal` | 1112 | 728 | 511 | ✓/✓/✓ |
| pi | `renderPanel` | 469 | 469 | 397 | ✓/✓/✓ |
| pi | `function compactBash` | 94 | 93 | 94 | ✓/✓/✓ |
| pi | `MEMORY_TYPES` | 347 | 248 | 215 | ✓/✓/✓ |
| yaml | `file:lexer` | 11 | 11 | 9 | ✓/✓/✓ |
| marked | `file:Tokenizer` | 5 | 5 | 4 | ✓/✓/✓ |
| pi | `file:panel` | 13 | 13 | 12 | ✓/✓/✓ |
| yaml | `file:anchors` | 12 | 12 | 11 | ✓/✓/✓ |
| **totale** | | **129936** | **29051** | **13736** | |

search vs grep -rn: 89% token in meno; vs grep di Pi: 53%

## E2: output di bash (offline, output reali)

Prima = output che Pi dà già al modello (ultime 2000 righe o 50 KB). Dopo = con lean-tools.

| output | righe | token prima | token dopo | risparmio | informazioni chiave conservate |
|---|---|---|---|---|---|
| vitest yaml (1 test rotto) | 661 | 13773 | 1311 | 90% | ✓ |
| vitest yaml (reporter default) | 140 | 1086 | 1086 | 0% | ✓ |
| marked test:unit (1 test rotto) | 526 | 7610 | 1538 | 80% | ✓ |
| marked specs (1 test rotto) | 886 | 14186 | 2806 | 80% | ✓ + 1 recuperate |
| git log yaml | 1380 | 14220 | 1061 | 93% | ✓ |
| find marked | 610 | 6916 | 885 | 87% | ✓ |
| log fixture 5000 righe | 1090 | 14215 | 1313 | 91% | ✓ |
| npm ls yaml | 331 | 3649 | 1022 | 72% | ✓ |
| **totale** | | **75655** | **11022** | **85%** | |

## E3: i 50 casi del primo giro (online, Sonnet)

| Braccio | Casi passati | Token in input | Richieste |
|---|---|---|---|
| `pi` | 50/50 | 2.255.557 | 263 |
| `pi` + lean-tools con `search` e `outline` | 50/50 | 2.360.653 (**+4,7%**) | 268 |

E3c: rifatto con i due bracci alternati compito per compito nello stesso momento, dopo che il prompt di sistema era cambiato:

| Braccio | Casi passati | Token in input | Richieste |
|---|---|---|---|
| `pi` | 50/50 | 2.283.379 | 264 |
| `pi` + lean-tools a costo zero | 50/50 | 2.200.511 (**−3,6%**) | 257 |

Per categoria (costo zero contro `pi`):

| Categoria | Variazione |
|---|---|
| qa | 0% |
| bugfix | +6% |
| feature | −6% |
| refactor | 0% |
| shell | −16% |
| edge | −25% |
| sessioni lunghe | −4% |

La mediana per coppia è 1,00: il risparmio viene dai pochi casi con output grandi.

## E4: 10 domande di navigazione su marked (online, Sonnet)

| Braccio | Passati | Token in input |
|---|---|---|
| `pi` (E4) | 20/20 | 235.502 |
| con `search` e `outline` | 20/20 | 238.910 (+1,4%) |
| `pi` (E4c, alternato) | 30/30 | 339.598 |
| a costo zero (E4c) | 30/30 | 354.644 (+4%, mediana per coppia 1,00: rumore) |

Nel primo E4 il braccio a costo zero ha sbagliato n02 due volte su due ("23 metodi" invece di 24). Rifatto con le trascrizioni, lo ha passato 2 volte su 2; in E4c lo ha passato 3 volte su 3. Era variabilità del modello, non un effetto dei tool.

## Problemi trovati e corretti durante gli esperimenti

- **File atteso nascosto da `search`.** Oltre il tetto il file giusto non compariva. Ora `search` nomina sempre i file esclusi, con il loro conteggio.
- **Riepilogo dei test perso.** Con molti fallimenti finiva fuori dal taglio. Ora resta sempre, e si compatta l'output completo che Pi salva quando tronca: così ricompare anche un riepilogo che il troncamento di Pi perdeva.
- **`outline` restituiva solo la firma.** Succedeva con un tipo oggetto nella firma (`): { ok: true } | …`).
- **Costo fisso misurato.** `search` +228 token, `outline` +140: per questo sono spenti di default.

## Nota di metodo

- **Esperimenti invalidati.** Durante gli esperimenti il prompt di sistema di Pi è cambiato due volte: prima +5.900 token, quando sono tornate valide 8 skill tasksphere; poi −5.900, quando sono state rese solo manuali. I confronti misurati in momenti diversi (E3b, E4b) non sono validi e sono esclusi. Valgono solo E3c ed E4c, con i bracci alternati nello stesso momento.
- **Token stimati.** I token degli esperimenti offline sono stime: contano i rapporti, non i valori assoluti.
