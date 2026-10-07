/**
 * Up to 4 numbered next steps at the end of a turn (Neon Night principle 4). The model is asked for them in a marked
 * block that is cut out of the answer; keys 1-4 on an empty prompt put one in the editor.
 */
import { truncateToWidth } from "@earendil-works/pi-tui";
import { C, fg, pad } from "./palette.ts";

export const SUGGESTION_MARK = "<!--suggerimenti-->";

export const SUGGESTION_PROMPT = [
	"## Suggerimenti",
	`Alla fine della risposta finale di un turno (non nei messaggi prima delle chiamate ai tool), se utile aggiungi fino a 4 prossimi passi brevi che l'utente potrebbe chiederti, nella sua lingua, in questo formato esatto e senza altro testo dopo:`,
	SUGGESTION_MARK,
	"- primo passo",
	"- secondo passo",
].join("\n");

export function extractSuggestions(markdown: string): { text: string; suggestions: string[] } {
	const index = markdown.indexOf(SUGGESTION_MARK);
	if (index < 0) return { text: markdown, suggestions: [] };
	const suggestions = markdown
		.slice(index + SUGGESTION_MARK.length)
		.split("\n")
		.map((line) => /^\s*[-*•]\s+(.+?)\s*$/.exec(line)?.[1])
		.filter((line): line is string => Boolean(line))
		.slice(0, 4);
	return { text: markdown.slice(0, index).trimEnd(), suggestions };
}

export function renderSuggestions(suggestions: string[], width: number): string {
	const items = suggestions.map((text, index) => `${fg(C.faint, "⟦")}${fg(C.mag, String(index + 1))}${fg(C.faint, "⟧")} ${fg(C.text, text)}`);
	return pad(truncateToWidth(`  ${items.join("   ")}`, width), width);
}
