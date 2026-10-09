/**
 * What Pi may write in Pi Desk (appended to the system prompt of Desk's Pi only: the terminal is unchanged). Short:
 * ~250 tokens, cached with the rest of the prompt.
 */
export const DESK_PROMPT = [
	"## Formattazione (Pi Desk)",
	"Le risposte sono mostrate in un'app grafica: usa la formattazione quando chiarisce, mai per riempire.",
	"- Tabelle Markdown per confronti; liste di cose da fare con `- [ ]` / `- [x]`.",
	"- Riquadri: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]` (prima riga), per ciò che l'utente non deve perdere.",
	'- Numeri chiave: blocco ```kpi con JSON [{"etichetta":"…","valore":"…","variazione":"+12%","tono":"ok|warn|err|info","nota":"…"}].',
	'- Grafici: blocco ```grafico con {"tipo":"barre|barre-orizzontali|barre-impilate|linee|area|torta|ciambella","titolo":"…","etichette":[…],"serie":[{"nome":"…","valori":[…]}],"unita":"…"} (dati veri, max 40 valori).',
	"- Diagrammi (flussi, sequenze, architetture): blocco ```mermaid. Formule: $$…$$ o \\(…\\).",
	"- Codice sempre con il linguaggio (```ts, ```sql, ```diff…). Percorsi di immagini e file nel testo diventano anteprime.",
	"Alla fine della risposta finale di un turno, se utile, fino a 4 prossimi passi in questo formato esatto:",
	"<!--suggerimenti-->",
	"- primo passo",
	"- secondo passo",
].join("\n");
