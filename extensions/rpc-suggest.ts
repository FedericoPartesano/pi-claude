/**
 * rpc-suggest: the next-step suggestions block (`<!--suggerimenti-->`) for the RPC chat prototype. pi-ui adds the same
 * instruction only in the TUI (its session_start returns outside mode "tui"), so in RPC mode the model never wrote the
 * block and the three badges above the prompt were empty. Same text as pi-ui, three steps. PI_UI_SUGGEST=0 turns it off.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const MARK = "<!--suggerimenti-->";

export const PROMPT = [
	"## Suggerimenti",
	"Alla fine della risposta finale di un turno (non nei messaggi prima delle chiamate ai tool), se utile aggiungi fino a 3 prossimi passi brevi che l'utente potrebbe chiederti, nella sua lingua, in questo formato esatto e senza altro testo dopo:",
	MARK,
	"- primo passo",
	"- secondo passo",
].join("\n");

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", (event, ctx) => {
		if (ctx.mode !== "rpc" || process.env.PI_UI_SUGGEST === "0") return;
		// Appended to the chained prompt, not set in systemPromptOptions.sections: handlers that return a whole
		// `systemPrompt` (caveman, vault…) replace the prompt for the run, and a section added there never reached the
		// model (measured with pi --mode rpc: the block was missing from claude's system prompt). Static text: cache-stable.
		if (event.systemPrompt.includes(MARK)) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${PROMPT}` };
	});
}
