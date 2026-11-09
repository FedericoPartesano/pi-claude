# Integrare le 25 skill di addyosmani/agent-skills in pi-claude
Aggiornato: 2026-11-09 · fase 1 (confermato) · profilo: rapido · tema: skill-di-terzi

## Problema e contesto
Si vogliono le 25 skill di `addyosmani/agent-skills` (MIT, 114k stelle, ultimo push 2026-11-01) come parte integrante di pi-claude. Oggi `package.json` dichiara solo `pi.extensions`; le skill personali stanno in `~/.agents/skills/` (symlink, fuori dal repo). Pi supporta `pi.skills` nei pacchetti e `disable-model-invocation: true`. Cinque skill duplicano le tue (`tdd`, `code-review`, `diagnosing-bugs`, `grilling`, `domain-modeling`). Le descrizioni visibili finiscono nel prompt a ogni richiesta (stima ~1500 token per 25, da misurare): contro il mantra.

## Risultato atteso
Le 25 skill sono disponibili in ogni installazione di pi-claude dopo `./install.sh`, ciascuna invocabile col suo comando, e il costo fisso del prompt non cresce di più di 300 token.

## Modo di fallimento
Il costo fisso supera 300 token, oppure una skill collide con un comando o una skill esistente, oppure `./install.sh` non le trova su macOS o Windows. Visibile al primo test di installazione.

## Vincoli duri
- Licenza MIT: `LICENSE` e attribuzione nel repo. Zero dipendenze nuove. Linux, macOS, WSL, Windows.
- Nessun commit senza richiesta; versione gestita da release-please.
- Mantra: token prima, poi velocità e leggerezza; ogni costo misurato e riportato in `eval/`.

## Scenari di qualità
| Scenario | Misura | Peso | Portante |
|---|---|---|---|
| Costo fisso di prompt | token del prompt con e senza le skill, misurati (≤ +300) | 5 | sì |
| Nessuna collisione | nessun nome di skill o comando duplicato; test automatico | 4 | sì |
| Installazione | `./install.sh` le rende visibili su Linux/WSL (provato), macOS/Windows (non provati) | 4 | no |
| Aggiornabilità | `scripts/sync-skills.mjs` riallinea al repo di Addy senza perdere le note | 3 | no |
| Coerenza con Pi | strumenti non esistenti in Pi (plugin, subagenti, DevTools MCP) segnalati da una nota | 2 | no |

## Ipotesi da smontare e candidata dichiarata
Candidata A: copia in `skills/agent-skills/` con LICENSE e attribuzione, `pi.skills` in `package.json`, script di sincronizzazione; tutte nascoste (`disable-model-invocation: true`) tranne `using-agent-skills` e poche scelte; le cinque doppie con prefisso `ads-` e nascoste; 9 comandi con prefisso `as:`; testo originale invariato più nota sulla mappa degli strumenti. Ipotesi da smontare: che nascoste costino davvero zero; che `/as:` non collida; che Pi carichi `pi.skills` da pacchetto installato.

## Riferimenti amati / odiati
`architetto/references/pi.md` (mappa azioni → tool di Pi). Odiato: costo fisso nel prompt.

## Decisioni del round 2
- Visibile al modello solo `using-agent-skills`; le altre 24 con `disable-model-invocation: true`.
- Testo in inglese invariato.
- Fuori da auto mode le skill non partono da sole (solo su richiesta o dall'indice). Dentro auto mode sì: ogni fase legge la skill giusta da `skills/agent-skills/phases.json` (mappa fase → skill, modificabile). Costo fisso zero fuori da auto mode.
- Confine: questo studio copre skill + contratto con auto mode (`phases.json`, percorso, invocazione). Auto mode (ciclo, limiti, arresto, permessi) ha studio e intent propri.
- `doubt-driven-development` è nella mappa come freno di default prima di ogni scelta non banale (da confermare nello studio di auto mode).

## Contesto aggiunto
Auto mode: evoluzione di `/goal`: dato un goal, sviluppa, pianifica e implementa in totale autonomia, usando anche skill come agent-skills. Regole da rivedere là: tradeoff decisi dall'utente (#r92), commit solo su richiesta.

## Fuori perimetro e anti-obiettivi
Modificare il contenuto delle skill di Addy; uso dal bridge `claude -p`; interfaccia nel prototipo (pannello o picker di skill). Anti-obiettivo: perdere la sincronizzazione con l'upstream.

## Decisioni già prese (ADR letti)
Nessun ADR. Dal progetto: token prima di tutto (CLAUDE.md), le estensioni importate si registrano col percorso reale, nessun commit senza richiesta.
