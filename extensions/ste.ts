/**
 * STE: answer style based on ASD-STE100 (Simplified Technical English). OFF by default; toggled with /ste on|off|status.
 * Same shape as caveman: one fixed text appended to the system prompt (stable, so the prompt cache keeps it), the choice
 * is saved in the agent dir, and a footer badge shows the state. When off, the handler returns at once and adds nothing.
 *
 * Coexistence with caveman: both cannot be active. Caveman is listed first in package.json, so its handler runs first;
 * when STE is on, this handler cuts the caveman block from the system prompt and adds its own. STE wins, and
 * `/ste status` and `/ste on` say so when caveman is not "off". Caveman's own setting is not changed.
 * Rules are not enforced by code: they only steer the model. Code, paths, commands and errors stay exact.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const MARKER = "Answer style (ASD-STE100)";
export const RULES = `${MARKER}
Write in ASD-STE100 Simplified Technical English. Max 20 words per sentence in procedures, 25 in descriptions. One instruction per sentence. Active voice. Simple tenses only. Use approved, simple words. No -ing form, except technical nouns. Do not omit articles. Use vertical lists for steps. Code, paths, commands and error text stay exact.`;

/** STE + caveman: STE wording rules (simple words, one meaning, active voice, short sentences) on a telegraphic answer. */
export const COMBO = `${MARKER}
Answer with the fewest words that carry all the facts, in ASD-STE100 Simplified Technical English wording. Reply in the user's language.
1. Answer first, then the reason, then the next step. No greeting, preamble, recap, or offer of help. Each fact once.
2. Telegraphic: fragments are allowed, articles may be dropped. Max 20 words per sentence. One instruction per sentence. No filler or emphasis words.
3. Active voice. Simple words with one meaning. No -ing form, except technical nouns. Steps as a flat list.
4. Never cut a negation or a limit (not, never, only, except). Numbers, units, paths, names, commands and error text stay exact.
5. Warnings, irreversible actions and steps where the order matters: full sentences.`;

const CAVEMAN_MARKER = "Stile delle risposte (caveman)";
const saved = () => join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "ste-mode");

/** State at start: PI_STE (1 = on, 0 = off) if set; else the last /ste choice; else off. */
export function startOn(): boolean {
	const env = process.env.PI_STE;
	if (env !== undefined && env !== "") return env !== "0";
	try { return readFileSync(saved(), "utf8").trim() === "on"; } catch { return false; }
}

/** Returns the prompt without caveman and STE blocks (both sit at the end, caveman first). */
function strip(prompt: string): string {
	const cut = (text: string, marker: string) => {
		const at = text.indexOf(`\n\n${marker}`);
		if (at < 0) return text;
		const next = text.indexOf("\n\n" + (marker === MARKER ? CAVEMAN_MARKER : MARKER), at + 2);
		return text.slice(0, at) + (next >= 0 ? text.slice(next) : "");
	};
	return cut(cut(prompt, CAVEMAN_MARKER), MARKER);
}

/** Caveman level as saved or set in the environment; "off" when unknown. */
function cavemanActive(): boolean {
	const env = process.env.PI_CAVEMAN;
	if (env !== undefined && env !== "") return env !== "0";
	try {
		const value = readFileSync(join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "caveman-level"), "utf8").trim();
		return value !== "off";
	} catch { return true; } // caveman defaults to full
}

export default function (pi: ExtensionAPI) {
	let on = startOn();
	const show = (ctx: { hasUI: boolean; ui: { setStatus(key: string, text: string | undefined): void } }) => {
		if (ctx.hasUI) ctx.ui.setStatus("ste", on ? "on" : undefined);
	};
	const state = () => `STE: ${on ? "on" : "off"}.${on && cavemanActive() ? " Caveman is off while STE is on (STE wins)." : ""}`;
	pi.on("session_start", (_event, ctx) => show(ctx));
	pi.registerCommand("ste", {
		description: "ASD-STE100 answer style: /ste on · off · status",
		handler: async (args, ctx) => {
			const wanted = args.trim().toLowerCase();
			if (wanted && wanted !== "status" && wanted !== "on" && wanted !== "off") return ctx.ui.notify("Use: /ste on, off or status.", "warning");
			if (wanted === "on" || wanted === "off") {
				on = wanted === "on";
				try { writeFileSync(saved(), wanted); } catch {}
				show(ctx);
			}
			ctx.ui.notify(wanted === "on" || wanted === "off" ? `${state()} Applies from the next answer.` : state(), "info");
		},
	});
	pi.on("before_agent_start", (event) => {
		if (!on) return undefined; // zero cost when off: caveman and the rest of the prompt stay as they are
		const next = `${strip(event.systemPrompt)}\n\n${RULES}`;
		return next === event.systemPrompt ? undefined : { systemPrompt: next };
	});
}
