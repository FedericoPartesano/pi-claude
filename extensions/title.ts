/**
 * title: /title sets one name for the terminal tab and the saved session (shown by `pi --resume`).
 *   /title <text>   set it       /title   show it       /title auto   let a short haiku call write it from the chat
 * After the first answer of a chat with no name, Pi writes one by itself (one haiku call, a few hundred tokens, once) and
 * says so; change it any time with /title. PI_TITLE_AUTO=0 turns the automatic title off, PI_TITLE=0 the command too.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const MAX_TITLE = 60;

export const TITLE_SYSTEM =
	"Write a title for this chat between a user and a coding assistant. Reply with only the title: 2 to 6 words, in the language of the user, no quotes, no final period, say what the work is about (not 'chat' or 'help').";

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const cut = (text: string) => (text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1).trimEnd()}…` : text);

/** The model's answer as a safe one-line title, or undefined when it is empty. */
export function cleanTitle(raw: string): string | undefined {
	const line = raw.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
	const wrap = /^["'«“`*#\s]+|["'»”`*.\s]+$/g;
	const text = line.replace(CONTROL, "").replace(wrap, "").replace(/^(titolo|title)\s*:\s*/i, "").replace(wrap, "").trim();
	return text ? cut(text) : undefined;
}

/** What the user typed after /title: a name to set, or one of the two words. */
export function parseTitleArgs(args: string): { action: "show" } | { action: "auto" } | { action: "set"; name: string } {
	const text = args.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
	if (!text) return { action: "show" };
	if (text.toLowerCase() === "auto") return { action: "auto" };
	return { action: "set", name: cut(text) };
}

type Block = { type?: string; text?: string };
const textOf = (content: unknown): string =>
	typeof content === "string" ? content : Array.isArray(content) ? (content as Block[]).filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n") : "";

/** The first user message and the first answer of the branch, cut short: all the model needs to name the chat. */
export function chatExcerpt(branch: unknown[]): string | undefined {
	let user: string | undefined;
	let answer: string | undefined;
	for (const entry of branch as { type?: string; message?: { role?: string; content?: unknown } }[]) {
		if (entry.type !== "message" || !entry.message) continue;
		const text = textOf(entry.message.content).trim();
		if (!text) continue;
		if (entry.message.role === "user" && user === undefined) user = text;
		else if (entry.message.role === "assistant" && user !== undefined && answer === undefined) answer = text;
		if (user !== undefined && answer !== undefined) break;
	}
	if (user === undefined) return undefined;
	return `User: ${user.slice(0, 600)}${answer ? `\n\nAssistant: ${answer.slice(0, 600)}` : ""}`;
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_TITLE === "0") return;
	let tried = false; // one automatic attempt per session
	let busy = false;

	const generate = async (ctx: ExtensionContext): Promise<string | undefined> => {
		const excerpt = chatExcerpt(ctx.sessionManager.getBranch());
		if (!excerpt) return undefined;
		const model = ctx.modelRegistry.find("claude-code", process.env.PI_DREAM_MODEL ?? "haiku");
		if (!model) return undefined;
		const stream = ctx.modelRegistry.streamSimple(model, {
			systemPrompt: TITLE_SYSTEM,
			messages: [{ role: "user", content: [{ type: "text", text: excerpt }], timestamp: Date.now() }],
		} as never);
		for await (const _event of stream) {
			// drain: the final message has the answer
		}
		const message = await stream.result();
		if (message.stopReason === "error") return undefined;
		return cleanTitle(message.content.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join(""));
	};

	pi.registerCommand("title", {
		description: "Title of this chat (tab and saved session): /title <text>, /title, /title auto",
		handler: async (args, ctx) => {
			const parsed = parseTitleArgs(args ?? "");
			if (parsed.action === "show") {
				const current = pi.getSessionName();
				return void ctx.ui.notify(current ? `Titolo: ${current}. Cambialo con /title <testo>, oppure /title auto.` : "Nessun titolo. Scrivilo con /title <testo>, oppure /title auto.", "info");
			}
			if (parsed.action === "set") {
				pi.setSessionName(parsed.name);
				return void ctx.ui.notify(`Titolo: ${parsed.name}`, "info");
			}
			ctx.ui.notify("Scrivo un titolo dalla chat…", "info");
			const session = ctx.sessionManager.getSessionId?.();
			try {
				const name = await generate(ctx);
				if (!name) return void ctx.ui.notify("Non riesco a scrivere un titolo (chat vuota o modello non disponibile). Usa /title <testo>.", "warning");
				if (session !== ctx.sessionManager.getSessionId?.()) return;
				pi.setSessionName(name);
				ctx.ui.notify(`Titolo: ${name}`, "info");
			} catch {
				// session changed under us: stay silent
			}
		},
	});

	if (process.env.PI_TITLE_AUTO === "0") return;
	pi.on("session_start", () => {
		tried = false;
	});
	pi.on("agent_end", (_event, ctx) => {
		if (tried || busy || !ctx.hasUI || pi.getSessionName()) return;
		tried = true;
		busy = true;
		const session = ctx.sessionManager.getSessionId?.();
		void (async () => {
			try {
				const name = await generate(ctx);
				// the user may have named it, or changed session, while the model was thinking
				if (!name || pi.getSessionName() || session !== ctx.sessionManager.getSessionId?.()) return;
				pi.setSessionName(name);
				ctx.ui.notify(`Titolo della chat: ${name}. Cambialo con /title.`, "info");
			} catch {
				// stale context or model error: no title, no noise
			} finally {
				busy = false;
			}
		})();
	});
}
