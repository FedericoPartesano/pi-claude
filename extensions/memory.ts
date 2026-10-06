/**
 * Memory ("human-like"): /dream consolidates past sessions into .pi/memory.md (project) or ~/.pi/agent/memory.md
 * (global), loaded into the prompt within a cap; /ricorda searches the archive. Zero cost without memory files.
 *
 *   PI_DREAM_SESSIONS_DIR   sessions root to read (default: this project's Pi session folder)
 *   PI_DREAM_AUTO_APPROVE=1 apply proposals without asking (evaluation)
 *   PI_DREAM_MODEL          model of the claude-code provider for consolidation (default: haiku)
 *   PI_MEMORY_GLOBAL_PATH   global memory file (default ~/.pi/agent/memory.md; "" = no global memory)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	applyProposal,
	bm25Search,
	buildDreamPrompt,
	contextLine,
	countNewSessions,
	findProjectSessions,
	fitBudget,
	lookback,
	parseMemory,
	parseProposal,
	renderMemory,
	staleIds,
	type MemoryEntry,
	type Proposal,
} from "./memory-core.ts";

/** ~1.000 tokens of memory in context at most. */
export const CONTEXT_BUDGET_CHARS = 3600;
const LOOKBACK_CHARS = 60_000; // ≈ 16k tokens to the consolidation model at most
const FADE_DAYS = 60;
const REMIND_AFTER = 5;

const agentDir = () => process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const files = (base: string) => ({ memory: join(base, "memory.md"), archive: join(base, "memory-archive.md"), state: join(base, "memory-state.json"), proposal: join(base, "dream-proposal.md"), last: join(base, "dream-last.json") });
const projectFiles = (cwd: string) => files(join(cwd, ".pi"));
/** Global memory files next to PI_MEMORY_GLOBAL_PATH (default ~/.pi/agent/memory.md); undefined when disabled. */
function globalFiles() {
	const path = process.env.PI_MEMORY_GLOBAL_PATH ?? join(agentDir(), "memory.md");
	return path === "" ? undefined : { ...files(dirname(path)), memory: path };
}
const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
const write = (path: string, text: string) => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
};
const readState = (path: string): { lastConsolidated?: string } => {
	try {
		return JSON.parse(read(path) || "{}");
	} catch {
		return {};
	}
};
const today = () => new Date().toISOString().slice(0, 10);

function sessionFiles(ctx: ExtensionContext): string[] {
	const root = process.env.PI_DREAM_SESSIONS_DIR;
	if (root) return findProjectSessions(root, ctx.cwd);
	try {
		const dir = ctx.sessionManager.getSessionDir();
		return findProjectSessions(dirname(dir), ctx.cwd);
	} catch {
		return findProjectSessions(join(agentDir(), "sessions"), ctx.cwd);
	}
}

/** One call to the consolidation model through the claude-code provider. */
async function consolidate(ctx: ExtensionContext, prompt: string) {
	const model = ctx.modelRegistry.find("claude-code", process.env.PI_DREAM_MODEL ?? "haiku") ?? ctx.model;
	if (!model) throw new Error("nessun modello disponibile per il consolidamento");
	const stream = ctx.modelRegistry.streamSimple(model, {
		systemPrompt: "Consolidi la memoria di un assistente di programmazione. Rispondi solo con JSON valido.",
		messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
	} as never);
	for await (const _event of stream) {
		// Drain the stream; the final message carries text and usage.
	}
	const message = await stream.result();
	const text = message.content.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join("");
	return { text, usage: message.usage, error: message.stopReason === "error" ? message.errorMessage : undefined };
}

function describe(memory: MemoryEntry[], proposal: Proposal): string[] {
	const name = (id: string) => memory[Number(id.slice(1)) - 1]?.text ?? id;
	return [
		...proposal.add.map((item) => `+ [${item.type}] ${item.text}`),
		...proposal.reinforce.map((id) => `↑ ${name(id)}`),
		...proposal.merge.map((item) => `⇄ ${item.ids.map(name).join(" + ")} → ${item.text}`),
		...proposal.update.map((item) => `✎ ${name(item.id)} → ${item.text}`),
		...proposal.forget.map((item) => `− ${name(item.id)}${item.reason ? ` (${item.reason})` : ""}`),
	];
}

export default function (pi: ExtensionAPI) {
	// Long-term memory in the prompt, as a stable section (same files → same prefix → cache hits). No files → nothing.
	pi.on("before_agent_start", (event, ctx) => {
		const globalMemory = globalFiles()?.memory;
		const entries = [...(globalMemory ? parseMemory(read(globalMemory)) : []), ...parseMemory(read(projectFiles(ctx.cwd).memory))];
		if (entries.length === 0) return;
		const kept = fitBudget(entries, CONTEXT_BUDGET_CHARS);
		event.systemPromptOptions.sections.memory = ["Ricordi dalle sessioni precedenti (rispettali; se la richiesta attuale li contraddice, vale la richiesta):", ...kept.map(contextLine)].join("\n");
	});

	// Free reminder: only stats of session files.
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		try {
			const pending = countNewSessions(sessionFiles(ctx), readState(projectFiles(ctx.cwd).state).lastConsolidated ?? "");
			if (pending >= REMIND_AFTER) ctx.ui.notify(`${pending} sessioni da consolidare → /dream`, "info");
		} catch {
			// No sessions folder yet.
		}
	});

	pi.registerCommand("dream", {
		description: "Consolida le sessioni passate nella memoria (come il sonno): /dream · /dream --global per le preferenze personali",
		handler: async (args, ctx) => {
			const global = /--global\b/.test(args);
			const globalTarget = globalFiles();
			if (global && !globalTarget) return ctx.ui.notify("Memoria globale disattivata (PI_MEMORY_GLOBAL_PATH vuota).", "warning");
			const target = global ? globalTarget! : projectFiles(ctx.cwd);
			const stateFile = projectFiles(ctx.cwd).state;
			const state = readState(stateFile);
			const since = (global ? (readState(target.state).lastConsolidated) : state.lastConsolidated) ?? "";
			let exclude: string | undefined;
			try {
				exclude = ctx.sessionManager.getSessionFile();
			} catch {}
			const sessions = lookback(sessionFiles(ctx), { since, maxChars: LOOKBACK_CHARS, exclude });
			if (!sessions) return ctx.ui.notify("Niente di nuovo da consolidare.", "info");

			const memory = parseMemory(read(target.memory));
			const archive = parseMemory(read(target.archive));
			const date = today();
			ctx.ui.notify(`Consolido la memoria${global ? " globale" : ""}…`, "info");
			const answer = await consolidate(ctx, buildDreamPrompt(memory, sessions, date, { global }));
			const parsed = answer.error ? { ok: false as const, error: answer.error } : parseProposal(answer.text, memory.length);
			if (!parsed.ok) {
				write(target.proposal, `# Proposta non valida\n\n${parsed.error}\n\n${answer.text}\n`);
				return ctx.ui.notify(`/dream: ${parsed.error} (risposta in ${target.proposal})`, "error");
			}
			const proposal = parsed.proposal;
			// Fading is decided by code, not by the model.
			for (const id of staleIds(memory, date, FADE_DAYS)) if (!proposal.forget.some((item) => item.id === id)) proposal.forget.push({ id, reason: `sbiadito (nessuna conferma da ${FADE_DAYS} giorni)` });

			const lines = describe(memory, proposal);
			if (lines.length === 0) {
				write(target.state, JSON.stringify({ lastConsolidated: new Date().toISOString() }));
				return ctx.ui.notify("Niente da ricordare in queste sessioni.", "info");
			}
			let approved: Proposal | undefined = proposal;
			if (process.env.PI_DREAM_AUTO_APPROVE !== "1") {
				if (!ctx.hasUI) {
					write(target.proposal, `# Proposta di /dream (${date})\n\n${lines.join("\n")}\n\n\`\`\`json\n${JSON.stringify(proposal, null, 2)}\n\`\`\`\n`);
					return ctx.ui.notify(`Proposta in ${target.proposal}: rilancia /dream in modalità interattiva per approvarla.`, "info");
				}
				const choice = await ctx.ui.select(`/dream propone:\n${lines.join("\n")}`, ["Applica tutto", "Scegli voce per voce", "Annulla"]);
				if (!choice || choice === "Annulla") approved = undefined;
				else if (choice === "Scegli voce per voce") {
					const keep = async (label: string) => ctx.ui.confirm("Tenere?", label);
					const pick = async <T>(items: T[], label: (item: T) => string) => {
						const kept: T[] = [];
						for (const item of items) if (await keep(label(item))) kept.push(item);
						return kept;
					};
					const name = (id: string) => memory[Number(id.slice(1)) - 1]?.text ?? id;
					approved = {
						add: await pick(proposal.add, (item) => `+ [${item.type}] ${item.text}`),
						reinforce: await pick(proposal.reinforce, (id) => `↑ ${name(id)}`),
						merge: await pick(proposal.merge, (item) => `⇄ ${item.text}`),
						update: await pick(proposal.update, (item) => `✎ ${name(item.id)} → ${item.text}`),
						forget: await pick(proposal.forget, (item) => `− ${name(item.id)}`),
					};
				}
			}
			if (!approved) return ctx.ui.notify("Memoria invariata.", "info");

			const result = applyProposal(memory, archive, approved, date);
			write(target.memory, renderMemory(result.memory));
			write(target.archive, renderMemory(result.archive, "archive"));
			const now = new Date().toISOString();
			write(target.state, JSON.stringify({ lastConsolidated: now }));
			if (global) write(stateFile, JSON.stringify({ ...state, lastConsolidated: state.lastConsolidated ?? "" }));
			const contextChars = fitBudget(result.memory, CONTEXT_BUDGET_CHARS).map(contextLine).join("\n").length;
			const summary = { ...result.counts, entries: result.memory.length, contextTokens: Math.round(contextChars / 3.6), usage: answer.usage };
			write(target.last, JSON.stringify(summary, null, 2));
			const { added, reinforced, merged, updated, forgotten } = result.counts;
			ctx.ui.notify(`Memoria aggiornata: +${added} nuovi, ${reinforced} rinforzati, ${merged} uniti, ${updated} aggiornati, ${forgotten} dimenticati · ${result.memory.length} ricordi (~${summary.contextTokens} token in contesto)`, "info");
		},
	});

	pi.registerCommand("ricorda", {
		description: "Cerca nei ricordi archiviati: /ricorda <cosa> [--use per metterli nel contesto]",
		handler: async (args, ctx) => {
			const use = /--use\b/.test(args);
			const query = args.replace(/--use\b/, "").trim();
			if (!query) return ctx.ui.notify("Uso: /ricorda <cosa> [--use]", "info");
			const globalArchive = globalFiles()?.archive;
			const archive = [...(globalArchive ? parseMemory(read(globalArchive)) : []), ...parseMemory(read(projectFiles(ctx.cwd).archive))];
			const hits = bm25Search(archive, query, 5);
			if (hits.length === 0) return ctx.ui.notify("Nessun ricordo trovato.", "info");
			const text = hits.map((entry) => `- [${entry.type}] ${entry.text}${entry.reason ? ` (${entry.reason})` : ""}`).join("\n");
			ctx.ui.notify(text, "info");
			if (use || (ctx.hasUI && (await ctx.ui.confirm("Mettere questi ricordi nel contesto?", text)))) {
				pi.sendMessage({ customType: "memory-recall", content: `Ricordi richiamati:\n${text}`, display: true });
			}
		},
	});
}
