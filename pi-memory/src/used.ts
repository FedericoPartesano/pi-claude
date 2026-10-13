/**
 * What the memory loaded for one request, shown as a quiet line under the answer (for debugging and curiosity).
 * Costs nothing: it only reports the recall that already happened, nothing is added to the prompt or asked of the model.
 * It says what the model was given, not whether it used it.
 */

export interface LoadedMemory {
	id: string;
	type: string;
	text: string;
	/** Reached through the memory graph, not by the request's words. */
	linked?: boolean;
}

/** Start of the first line: the renderer colors it as a badge. */
export const BADGE = "◆ RICORDI";
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/** One compact line, or (expanded) one line per memory with its type and full text. */
export function loadedLines(memories: LoadedMemory[], width: number, expanded: boolean): string[] {
	if (memories.length === 0) return [];
	if (expanded) return [`${BADGE} ${memories.length} ricordi caricati per questa risposta`, ...memories.map((m) => clip(`  #${m.id} [${m.type}]${m.linked ? " collegato:" : ""} ${flat(m.text)}`, width))];
	return [clip(`${BADGE} ${memories.length}  ${memories.map((m) => `#${m.id} ${flat(m.text)}`).join(" · ")}`, width)];
}
