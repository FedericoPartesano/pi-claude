/**
 * Memory ("human-like"): /dream consolidates past sessions into .pi/memory.md (project) or ~/.pi/agent/memory.md
 * (global), loaded into the prompt within a cap; /ricorda searches the archive. Zero cost without memory files.
 *
 *   PI_DREAM_SESSIONS_DIR   sessions root to read (default: this project's Pi session folder)
 *   PI_DREAM_AUTO_APPROVE=1 apply proposals without asking (evaluation)
 *   PI_DREAM_MODEL          model of the claude-code provider for consolidation (default: haiku)
 *   PI_MEMORY_GLOBAL_PATH   global memory file (default ~/.pi/agent/memory.md; "" = no global memory)
 *   PI_MEMORY_MODE          deep (default: everything on disk, recalled per request) | capped (memory.md within a cap)
 *   PI_MEMORY_RECALL_LOG=1  append one JSON line per request to <cwd>/.pi/memory/recall-log.jsonl (evaluation)
 *   PI_MEMORY_MODEL         embedding model: minilm (default) | e5
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	applyProposal,
	bm25Search,
	buildDreamPrompt,
	contextLine,
	countNewSessions,
	findProjectSessions,
	enforceCap,
	fitBudget,
	lookbackBatch,
	lookback,
	parseMemory,
	parseProposal,
	renderMemory,
	staleIds,
	type MemoryEntry,
	type Proposal,
} from "./memory-core.ts";
import { BackgroundEmbedder } from "../pi-memory/src/embed.ts";
import { Recaller, appendRecallLog, fillVectors, type StoreDirs } from "../pi-memory/src/engine.ts";
import { entriesToRecords, recordsToEntries } from "../pi-memory/src/reconcile.ts";
import { loadStore, migrateLegacy, pruneVectors, saveStore, storeExists } from "../pi-memory/src/store.ts";

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
const deepMode = () => process.env.PI_MEMORY_MODE !== "capped";
/** Deep store folders: <cwd>/.pi/memory and the global one next to the global memory file. */
function deepDirs(cwd: string): StoreDirs {
	const project = join(cwd, ".pi", "memory");
	const globalPath = process.env.PI_MEMORY_GLOBAL_PATH ?? join(agentDir(), "memory.md");
	return { project, global: globalPath === "" ? undefined : join(dirname(globalPath), "memory") };
}
/** One-time import of the capped files into the deep store. */
function migrate(cwd: string, date: string) {
	const project = projectFiles(cwd);
	migrateLegacy(deepDirs(cwd).project, project.memory, project.archive, date);
	const global = globalFiles();
	const dirs = deepDirs(cwd);
	if (global && dirs.global) migrateLegacy(dirs.global, global.memory, global.archive, date);
}
const hasStore = (dirs: StoreDirs) => storeExists(dirs.project) || (dirs.global !== undefined && storeExists(dirs.global));
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
	const embedder = new BackgroundEmbedder();
	const recaller = new Recaller();
	const logRecall = process.env.PI_MEMORY_RECALL_LOG === "1";

	// Deep memory: the pinned core goes in the system prompt (small, stable → cached); everything else is recalled
	// per request and appended after it as a message, only when relevant. No store → nothing, at no cost.
	pi.on("before_agent_start", async (event, ctx) => {
		if (!deepMode()) return capped(event, ctx);
		const started = performance.now();
		const date = today();
		migrate(ctx.cwd, date);
		const dirs = deepDirs(ctx.cwd);
		const log = (injected: string[], chars: number, ready: boolean) => logRecall && appendRecallLog(dirs.project, { mode: "deep", query: event.prompt, injected, chars, estTokens: Math.round(chars / 3.6), embedderReady: ready, ms: Math.round((performance.now() - started) * 10) / 10 });
		if (!hasStore(dirs)) return void log([], 0, false);
		const core = recaller.core(dirs);
		if (core) event.systemPromptOptions.sections.memory = core;
		// Without a UI (pi -p) nobody waits for a background load: give the model a few seconds so recall is semantic.
		if (!ctx.hasUI && !embedder.ready && recaller.hasVectors(dirs)) await Promise.race([embedder.start(), new Promise((resolve) => setTimeout(resolve, 8000).unref())]);
		const run = await recaller.run(event.prompt, dirs, date, embedder.ready ? embedder : undefined);
		log(run.ids, run.chars, run.embedderReady);
		if (!run.text) return;
		return { message: { customType: "memory-recall", content: run.text, display: false } };
	});

	// Capped mode (previous behavior): memory.md in the prompt within a cap.
	const capped = (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
		const started = performance.now();
		const globalMemory = globalFiles()?.memory;
		const entries = [...(globalMemory ? parseMemory(read(globalMemory)) : []), ...parseMemory(read(projectFiles(ctx.cwd).memory))];
		const kept = entries.length === 0 ? [] : fitBudget(entries, CONTEXT_BUDGET_CHARS);
		const section = kept.length === 0 ? "" : ["Ricordi dalle sessioni precedenti (rispettali; se la richiesta attuale li contraddice, vale la richiesta):", ...kept.map(contextLine)].join("\n");
		if (section) event.systemPromptOptions.sections.memory = section;
		if (logRecall) appendRecallLog(join(ctx.cwd, ".pi", "memory"), { mode: "capped", query: event.prompt, injected: [], chars: section.length, estTokens: Math.round(section.length / 3.6), embedderReady: false, ms: Math.round((performance.now() - started) * 10) / 10 });
	};

	// Free reminder: only stats of session files.
	pi.on("session_start", (_event, ctx) => {
		// Deep mode: load the embedding model in the background, after startup, only if there is memory to recall.
		if (deepMode() && ctx.hasUI) {
			const dirs = deepDirs(ctx.cwd);
			migrate(ctx.cwd, today());
			if (hasStore(dirs)) {
				setTimeout(() => {
					void embedder.start().then(async (ready) => {
						if (!ready) return;
						for (const dir of [dirs.project, dirs.global]) if (dir && storeExists(dir)) await fillVectors(dir, embedder).catch(() => 0);
					});
				}, 1500).unref();
			}
		}
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
			// Oldest first, in batches: only what was actually read is marked consolidated.
			const batch = lookbackBatch(sessionFiles(ctx), { since, maxChars: LOOKBACK_CHARS, exclude });
			const sessions = batch.text;
			if (!sessions) return ctx.ui.notify("Niente di nuovo da consolidare.", "info");

			const date = today();
			const deep = deepMode();
			const dirs = deepDirs(ctx.cwd);
			const storeDir = global ? dirs.global! : dirs.project;
			if (deep) migrate(ctx.cwd, date);
			const previous = deep ? loadStore(storeDir) : undefined;
			const split = previous ? recordsToEntries(previous.records) : undefined;
			const memory = split ? split.memory : parseMemory(read(target.memory));
			const archive = split ? split.archive : parseMemory(read(target.archive));
			ctx.ui.notify(`Consolido la memoria${global ? " globale" : ""}…`, "info");
			const answer = await consolidate(ctx, buildDreamPrompt(memory, sessions, date, deep ? { global, deep: true } : { global, capChars: CONTEXT_BUDGET_CHARS }));
			const parsed = answer.error ? { ok: false as const, error: answer.error } : parseProposal(answer.text, memory.length);
			if (!parsed.ok) {
				write(target.proposal, `# Proposta non valida\n\n${parsed.error}\n\n${answer.text}\n`);
				return ctx.ui.notify(`/dream: ${parsed.error} (risposta in ${target.proposal})`, "error");
			}
			const proposal = parsed.proposal;
			// Fading is decided by code, not by the model.
			// Deep mode never fades by deletion: weak memories are just harder to recall.
			if (!deep) for (const id of staleIds(memory, date, FADE_DAYS)) if (!proposal.forget.some((item) => item.id === id)) proposal.forget.push({ id, reason: `sbiadito (nessuna conferma da ${FADE_DAYS} giorni)` });

			const lines = describe(memory, proposal);
			if (lines.length === 0) {
				// Measured: under load the model sometimes answers with an empty proposal for sessions full of rules. Never
				// mark sessions consolidated on a reply without content: keep them for the next /dream and keep the reply.
				const reply = (answer.text ?? "").replace(/```(?:json)?/g, "").trim();
				const looksEmpty = !reply || /^\{\s*\}$/.test(reply) || !/"(add|reinforce|merge|update|forget)"/.test(reply);
				write(target.last, JSON.stringify({ added: 0, empty: true, pending: batch.pending, usage: answer.usage }, null, 2));
				const allSkipped = parsed.ok && parsed.skipped.length > 0;
				if ((looksEmpty && sessions.length > 2000) || allSkipped) {
					write(target.proposal, `# Proposta senza voci valide (${date})\n\nScartate: ${parsed.ok ? parsed.skipped.join("; ") : ""}\n\n${answer.text ?? ""}\n`);
					return ctx.ui.notify(`/dream: il modello ha risposto senza contenuto; sessioni non segnate come consolidate, rilancia /dream (risposta in ${target.proposal}).`, "warning");
				}
				write(target.state, JSON.stringify({ lastConsolidated: batch.until }));
				return ctx.ui.notify(`Niente da ricordare in queste sessioni.${batch.pending ? ` Restano ${batch.pending} sessioni: rilancia /dream.` : ""}`, "info");
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

			const applied = applyProposal(memory, archive, approved, date);
			// Capped: the cap holds for the file too (what Pi sees is what memory.md contains). Deep: no cap at all.
			const capped = deep ? { memory: applied.memory, archive: applied.archive, moved: 0 } : enforceCap(applied.memory, applied.archive, CONTEXT_BUDGET_CHARS, date);
			const result = { ...applied, memory: capped.memory, archive: capped.archive };
			let deepRecords: ReturnType<typeof entriesToRecords> | undefined;
			if (deep && previous) {
				deepRecords = entriesToRecords(result.memory, result.archive, previous.records, date);
				saveStore(storeDir, { records: deepRecords, vectors: pruneVectors(previous.records, deepRecords, previous.vectors), model: previous.model });
			} else {
				write(target.memory, renderMemory(result.memory));
				write(target.archive, renderMemory(result.archive, "archive"));
			}
			const now = batch.until;
			write(target.state, JSON.stringify({ lastConsolidated: now }));
			if (global) write(stateFile, JSON.stringify({ ...state, lastConsolidated: state.lastConsolidated ?? "" }));
			const contextChars = deep ? 0 : fitBudget(result.memory, CONTEXT_BUDGET_CHARS).map(contextLine).join("\n").length;
			const summary = { ...result.counts, overCap: capped.moved, pending: batch.pending, entries: result.memory.length, contextTokens: Math.round(contextChars / 3.6), usage: answer.usage };
			write(target.last, JSON.stringify(summary, null, 2));
			const { added, reinforced, merged, updated, forgotten } = result.counts;
			if (deep) {
				// New or edited memories get their embedding now, so the next request can recall them semantically.
				ctx.ui.notify("Calcolo gli embedding dei ricordi nuovi…", "info");
				if (await embedder.start()) await fillVectors(storeDir, embedder).catch(() => 0);
				return ctx.ui.notify(`Memoria aggiornata: +${added} nuovi, ${reinforced} rinforzati, ${merged} uniti, ${updated} aggiornati (superati), ${forgotten} dimenticati · ${deepRecords?.filter((record) => record.status === "active").length ?? 0} ricordi attivi, nessun tetto${batch.pending ? ` · restano ${batch.pending} sessioni: rilancia /dream` : ""}`, "info");
			}
			ctx.ui.notify(`Memoria aggiornata: +${added} nuovi, ${reinforced} rinforzati, ${merged} uniti, ${updated} aggiornati, ${forgotten} dimenticati${capped.moved ? `, ${capped.moved} archiviati per spazio` : ""} · ${result.memory.length} ricordi (~${summary.contextTokens} token in contesto)${batch.pending ? ` · restano ${batch.pending} sessioni: rilancia /dream` : ""}`, "info");
		},
	});

	pi.registerCommand("ricorda", {
		description: "Cerca nei ricordi archiviati: /ricorda <cosa> [--use per metterli nel contesto]",
		handler: async (args, ctx) => {
			const use = /--use\b/.test(args);
			const query = args.replace(/--use\b/, "").trim();
			if (!query) return ctx.ui.notify("Uso: /ricorda <cosa> [--use]", "info");
			if (deepMode()) {
				migrate(ctx.cwd, today());
				const dirs = deepDirs(ctx.cwd);
				if (!hasStore(dirs)) return ctx.ui.notify("Nessun ricordo trovato.", "info");
				if (!embedder.ready) await Promise.race([embedder.start(), new Promise((resolve) => setTimeout(resolve, 8000).unref())]);
				const run = await recaller.run(query, dirs, today(), embedder.ready ? embedder : undefined, { includeSuperseded: true, threshold: 0.25 });
				if (run.hits.length === 0) return ctx.ui.notify("Nessun ricordo trovato.", "info");
				const lines = run.hits.map(({ record }) => `- [${record.type}] ${record.text}${record.status === "superseded" ? ` (superato${record.reason ? `: ${record.reason}` : ""})` : ""}`).join("\n");
				ctx.ui.notify(lines, "info");
				if (use || (ctx.hasUI && (await ctx.ui.confirm("Mettere questi ricordi nel contesto?", lines)))) {
					pi.sendMessage({ customType: "memory-recall", content: `Ricordi richiamati:\n${lines}`, display: true });
				}
				return;
			}
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
