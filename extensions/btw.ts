/**
 * btw: /btw <question> asks a side question without interrupting the running turn (like Claude Code's /btw).
 * A separate one-shot `claude -p` (no tools, no session) gets the recent chat plus a side-question reminder and answers
 * once; the answer is shown in a widget above the editor and never enters the conversation. Earlier /btw exchanges of
 * this process are passed along. `/btw` alone clears the widget. PI_BTW_MODEL overrides the model.
 */
import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { recentChat } from "./advisor.ts";

export const BTW_REMINDER = [
	"<system-reminder>This is a side question from the user. You must answer this question directly in a single response.",
	"IMPORTANT CONTEXT:",
	"- You are a separate, lightweight agent spawned to answer this one question",
	"- The main agent is NOT interrupted: it continues working independently in the background",
	"- You share the conversation context but are a completely separate instance",
	'- Do NOT reference being interrupted or what you were "previously doing"',
	"CRITICAL CONSTRAINTS:",
	"- You have NO tools: you cannot read files, run commands, search, or take any actions",
	"- Do NOT write tool calls or tool output as text; if answering needs reading files or running commands, say it cannot be checked from a side question and suggest asking in the main conversation",
	"- This is a one-off response: there will be no follow-up turns",
	"- Answer only from what you already know from the conversation context",
	'- NEVER say "Let me try...", "I\'ll now...", "Let me check..."; if you do not know, say so',
	"Simply answer the question with the information you have.</system-reminder>",
].join("\n");

export const BTW_SYSTEM = "You answer side questions about an ongoing coding session. You have no tools. Answer in the language of the question, concisely.";

export type Exchange = { question: string; answer: string };

/** The whole prompt: recent chat, earlier side exchanges, the reminder, then the question. */
export function btwPrompt(chat: string, history: Exchange[], question: string): string {
	const past = history.map((e) => `Side question: ${e.question}\nSide answer: ${e.answer}`).join("\n\n");
	return [chat ? `Recent chat:\n\n${chat}` : "", past ? `Earlier side questions:\n\n${past}` : "", BTW_REMINDER, `Question: ${question}`].filter(Boolean).join("\n\n");
}

/** An answer that wrote tool calls as text is dropped: nothing ran. */
export const looksLikeToolText = (text: string) => /<(?:function_calls|invoke|antml:invoke)\b/i.test(text);

export function btwModel(ctx: Pick<ExtensionContext, "model">): string {
	if (process.env.PI_BTW_MODEL) return process.env.PI_BTW_MODEL;
	const model = ctx.model as { provider?: string; id?: string } | undefined;
	return model?.provider === "claude-code" && model.id ? model.id : "sonnet";
}

/** One-shot claude -p: prompt on stdin, answer on stdout. Rejects on non-zero exit or abort. */
export function runClaude(prompt: string, model: string, cwd: string, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		const args = ["-p", "--model", model, "--tools", "", "--system-prompt", BTW_SYSTEM, "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence", "--output-format", "text"];
		const env = { ...process.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_THINKING: "1" };
		for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) delete (env as Record<string, string | undefined>)[name];
		const child = spawn(process.env.PI_CLAUDE_BINARY ?? "claude", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], signal });
		let out = "";
		let err = "";
		child.stdout.on("data", (chunk) => (out += chunk));
		child.stderr.on("data", (chunk) => (err += chunk));
		child.on("error", reject);
		child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim().split("\n").pop() || `claude exited with ${code}`))));
		child.stdin.on("error", () => {});
		child.stdin.end(prompt);
	});
}

export default function (pi: ExtensionAPI) {
	const history: Exchange[] = [];
	pi.registerCommand("btw", {
		description: "Domanda laterale senza interrompere il lavoro: /btw <domanda> (senza testo chiude la risposta)",
		handler: async (args, ctx) => {
			const question = (args ?? "").trim();
			if (!question) {
				ctx.ui.setWidget("btw", undefined);
				return;
			}
			ctx.ui.setWidget("btw", [`/btw ${question}`, "…"]);
			try {
				const prompt = btwPrompt(recentChat(ctx.sessionManager.getBranch(), 16), history.slice(-5), question);
				const answer = await runClaude(prompt, btwModel(ctx), ctx.cwd);
				if (!answer || looksLikeToolText(answer)) {
					ctx.ui.setWidget("btw", [`/btw ${question}`, "(Nessuna risposta utile: una domanda laterale non può usare tool. Chiedilo nella conversazione principale.)"]);
					return;
				}
				history.push({ question, answer });
				ctx.ui.setWidget("btw", [`/btw ${question}`, ...answer.split("\n"), "", "(/btw senza testo per chiudere)"]);
			} catch (error) {
				ctx.ui.setWidget("btw", [`/btw ${question}`, `Errore: ${error instanceof Error ? error.message : "chiamata fallita"}`]);
			}
		},
	});
}
