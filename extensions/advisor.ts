/**
 * advisor: Haiku works, Opus advises through the native Claude Code advisor (`--advisor`, wired in pi-claude-code).
 *  - /advisor on|off|status turns it on or off; the footer shows an ADVISOR badge while it is active (Haiku only).
 *  - /brief <idea>: Opus writes a detailed intent file (intents/<date>-<slug>.md) from the idea and the project, so that
 *    Haiku can then carry it out with /goal @intents/<file>.
 * Env: PI_CLAUDE_ADVISOR=on starts with the advisor on (default: off); PI_ADVISOR_MODEL (model of /brief, default opus);
 * PI_ADVISOR_LOG=<file> appends one line per consult (kind, ms, ok, usage) for evals.
 */
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { INTENTS_DIR, intentTemplate, parseIntent, setStatus, slugify } from "./intent.ts";

export const ADVISOR_SYSTEM =
	"You are a senior advisor consulted by a smaller coding assistant that is doing the work. You have no tools and cannot change anything. Read the recent chat and the request, then answer with a short, concrete recommendation: what to do, what to avoid, what to check. If the plan is wrong, say so and give the better one. Answer in the language of the chat. At most 200 words.";

export const BRIEF_SYSTEM = (date: string) =>
	[
		"You write an intent.md for a smaller coding assistant that will carry it out with no further questions. You have no tools: use only the idea and the project context you are given.",
		"Be precise and complete, because the executor will follow the file literally:",
		"- Outcome: observable, verifiable points. Name the files, functions, signatures, formats and limits that the idea or the project implies; do not leave them to guess.",
		"- Constraints: edge cases and errors to handle, what must not change, what is out of scope.",
		"- Verifica: the exact commands that prove it (tests, build) when the project context shows them.",
		"- Open questions: only what is truly undecided and the executor cannot decide.",
		"- No design or implementation steps beyond what the requirements force.",
		"Write in the language of the idea. Reply with only the file, starting with the --- frontmatter, in exactly this format:",
		"",
		intentTemplate("<title>", date),
	].join("\n");
type Block = { type?: string; text?: string; name?: string; arguments?: unknown };
type Entry = { type?: string; message?: { role?: string; toolName?: string; content?: unknown } };

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const textOf = (content: unknown): string =>
	typeof content === "string" ? content : Array.isArray(content) ? (content as Block[]).filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n") : "";
const callsOf = (content: unknown): string[] =>
	Array.isArray(content) ? (content as Block[]).filter((b) => b?.type === "toolCall" && b.name).map((b) => `Tool call: ${b.name} ${cut(JSON.stringify(b.arguments ?? {}), 300)}`) : [];

/** The last `count` chat lines (messages, tool calls, tool results) as plain text, each cut short. */
export function recentChat(branch: unknown[], count = 16, max = 1500): string {
	const lines: string[] = [];
	for (const entry of branch as Entry[]) {
		if (entry.type !== "message" || !entry.message) continue;
		const { role, content } = entry.message;
		const text = textOf(content).trim();
		if (role === "user" && text) lines.push(`User: ${cut(text, max)}`);
		else if (role === "assistant") {
			if (text) lines.push(`Assistant: ${cut(text, max)}`);
			lines.push(...callsOf(content));
		} else if (role === "toolResult" && text) lines.push(`Tool result (${entry.message.toolName ?? "tool"}): ${cut(text, 500)}`);
	}
	return lines.slice(-Math.max(1, count)).join("\n\n");
}

/** The model's answer as the intent file: no code fence, nothing before the frontmatter. Undefined when there is none. */
export function intentMarkdown(raw: string): string | undefined {
	const text = raw.replace(/^\s*```(?:markdown|md)?\s*\n/i, "").replace(/\n```\s*$/, "");
	const start = text.search(/^---\s*$/m);
	return start < 0 ? undefined : `${text.slice(start).trim()}\n`;
}

/** Project context for the brief: file list, README start, package scripts. */
async function projectContext(cwd: string): Promise<string> {
	const files = await new Promise<string>((resolve) => execFile("rg", ["--files"], { cwd, maxBuffer: 4_000_000 }, (_error, stdout) => resolve(String(stdout ?? ""))));
	const read = (name: string, max: number) => {
		try {
			return readFileSync(join(cwd, name), "utf8").slice(0, max);
		} catch {
			return "";
		}
	};
	const parts = [`Files (first 150):\n${files.split("\n").slice(0, 150).join("\n")}`, `README (start):\n${read("README.md", 2500)}`, `package.json:\n${read("package.json", 1500)}`];
	return parts.filter((part) => !part.endsWith(":\n")).join("\n\n");
}

type Answer = { ok: boolean; text: string; usage?: unknown };

export const isHaiku = (id?: string) => /haiku/i.test(id ?? "");

/** The native advisor is on for Haiku only when PI_CLAUDE_ADVISOR is set and not "off" (same rule as pi-claude-code). */
export const nativeAdvisorOn = (id?: string) => isHaiku(id) && Boolean(process.env.PI_CLAUDE_ADVISOR) && process.env.PI_CLAUDE_ADVISOR !== "off";

export default function (pi: ExtensionAPI) {
	const consult = async (ctx: ExtensionContext, request: string, signal?: AbortSignal, kind = "tool", system = ADVISOR_SYSTEM): Promise<Answer> => {
		const started = Date.now();
		const result = await ask(ctx, request, signal, system);
		if (process.env.PI_ADVISOR_LOG) {
			try {
				appendFileSync(process.env.PI_ADVISOR_LOG, `${JSON.stringify({ kind, ms: Date.now() - started, ok: result.ok, usage: result.usage })}\n`);
			} catch {
				// logging is best effort
			}
		}
		return result;
	};

	const ask = async (ctx: ExtensionContext, request: string, signal: AbortSignal | undefined, system: string): Promise<Answer> => {
		const model = ctx.modelRegistry.find("claude-code", process.env.PI_ADVISOR_MODEL ?? "opus");
		if (!model) return { ok: false, text: "Advisor: model not available." };
		const chat = recentChat(ctx.sessionManager.getBranch(), Number(process.env.PI_ADVISOR_MESSAGES) || 16);
		try {
			const stream = ctx.modelRegistry.streamSimple(
				model,
				{
					systemPrompt: system,
					messages: [{ role: "user", content: [{ type: "text", text: `Recent chat:\n\n${chat}\n\nRequest:\n${request}` }], timestamp: Date.now() }],
				} as never,
				{ signal } as never,
			);
			for await (const _event of stream) {
				// drain: the final message has the answer
			}
			const message = await stream.result();
			if (message.stopReason === "error") return { ok: false, text: "Advisor: the call failed." };
			const answer = message.content.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join("").trim();
			return answer ? { ok: true, text: answer, usage: (message as { usage?: unknown }).usage } : { ok: false, text: "Advisor: empty answer." };
		} catch (error) {
			return { ok: false, text: `Advisor: ${error instanceof Error ? error.message : "call failed"}.` };
		}
	};

	pi.registerCommand("brief", {
		description: "Opus scrive un intent dettagliato da un'idea (/brief <idea>); poi Haiku lo esegue con /goal @intents/<file>",
		handler: async (args, ctx) => {
			const idea = (args ?? "").trim();
			if (!idea) return void ctx.ui.notify("Uso: /brief <idea>. Opus scrive intents/<data>-<slug>.md, poi /goal @intents/<file> lo esegue.", "info");
			ctx.ui.notify("Opus scrive l'intent…", "info");
			const date = new Date().toISOString().slice(0, 10);
			const context = await projectContext(ctx.cwd);
			const result = await consult(ctx, `Idea:\n${idea}\n\nProject context:\n${context}`, undefined, "brief", BRIEF_SYSTEM(date));
			const markdown = result.ok ? intentMarkdown(result.text) : undefined;
			if (!markdown) return void ctx.ui.notify(result.ok ? "Opus non ha restituito un intent valido. Riprova con più dettagli." : result.text, "warning");
			const intent = parseIntent(markdown);
			const ready = intent.missing.length === 0;
			const dir = join(ctx.cwd, INTENTS_DIR);
			mkdirSync(dir, { recursive: true });
			const base = `${date}-${slugify(intent.title || idea)}`;
			let file = `${base}.md`;
			for (let n = 2; existsSync(join(dir, file)); n++) file = `${base}-${n}.md`;
			writeFileSync(join(dir, file), setStatus(markdown, ready ? "ready" : "draft"));
			const gaps = ready ? "" : ` Mancano sezioni (${intent.missing.join(", ")}): resta draft, completala a mano.`;
			ctx.ui.notify(`Intent scritto: ${INTENTS_DIR}/${file} (${intent.outcomes.length} outcome).${gaps} Eseguilo con /model haiku e /goal @${INTENTS_DIR}/${file}`, "info");
		},
	});

	// Native Claude Code advisor (`--advisor opus`, set in pi-claude-code) works while the main model is Haiku.
	// /advisor on|off|status switches it for this pi process; the footer shows an ADVISOR badge while it is active.
	const show = (ctx: ExtensionContext) => {
		if (ctx.hasUI) ctx.ui.setStatus("advisor", nativeAdvisorOn(ctx.model?.id) ? "ON" : undefined);
	};
	pi.on("session_start", (_event, ctx) => show(ctx));
	pi.on("model_select", (event, ctx) => show({ ...ctx, model: event.model } as ExtensionContext));
	pi.registerCommand("advisor", {
		description: "Advisor Opus con Haiku: /advisor on | off | status",
		handler: async (args, ctx) => {
			const word = (args ?? "").trim().toLowerCase();
			if (word === "on") process.env.PI_CLAUDE_ADVISOR = "on";
			else if (word === "off") process.env.PI_CLAUDE_ADVISOR = "off";
			else if (word && word !== "status") return void ctx.ui.notify("Uso: /advisor on | off | status", "info");
			show(ctx);
			const haiku = isHaiku(ctx.model?.id);
			const on = nativeAdvisorOn("haiku");
			ctx.ui.notify(`Advisor ${on ? "attivo" : "spento"}${haiku || !on ? "" : ": parte quando scegli Haiku"}. Vale dalla prossima richiesta.`, "info");
		},
	});
}
