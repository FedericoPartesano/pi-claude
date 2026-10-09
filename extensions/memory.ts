/**
 * Memory ("human-like"): /dream consolidates past sessions into .pi/memory.md (project) or ~/.pi/agent/memory.md
 * (global), loaded into the prompt within a cap; /ricorda searches the archive; /memory shows and edits the memories.
 * The /dream result stays in the chat and setStatus("memory") tells what memory is doing. Zero cost without memory files.
 *
 *   PI_DREAM_SESSIONS_DIR   sessions root to read (default: this project's Pi session folder)
 *   PI_DREAM_AUTO_APPROVE=1 apply proposals without asking (evaluation)
 *   PI_DREAM_MODEL          model of the claude-code provider for consolidation (default: haiku)
 *   PI_MEMORY_GLOBAL_PATH   global memory file (default ~/.pi/agent/memory.md; "" = no global memory)
 *   PI_MEMORY_MODE          deep (default: everything on disk, recalled per request) | capped (memory.md within a cap)
 *   PI_MEMORY_RECALL_LOG=1  append one JSON line per request to <cwd>/.pi/memory/recall-log.jsonl (evaluation)
 *   PI_MEMORY_MODEL         embedding model: e5 (default, deeper recall at scale) | minilm
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	applyProposal,
	filterProposal,
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
import { MemoryWorker } from "../pi-memory/src/memory-worker-client.ts";
import { appendRecallLog, type StoreDirs } from "../pi-memory/src/engine.ts";
import { isSmallTalk, recallMessage } from "../pi-memory/src/recall.ts";
import { entriesToRecords, movePersonal, recordsToEntries } from "../pi-memory/src/reconcile.ts";
import { loadStore, migrateLegacy, pruneVectors, saveStore, storeExists, type MemoryRecord } from "../pi-memory/src/store.ts";
import { applyUsage, lifecycle } from "../pi-memory/src/forget.ts";
import { applyAction, dreamEntry, memoryStatus, recordLabel, recordPreview, summarize, type DreamEntry, type MemoryAction } from "../pi-memory/src/dashboard.ts";
import type { DashboardResult, View } from "../pi-memory/src/dashboard-tui.ts";
import { answerPrompt, appendDreamRun, appendRecallEvent, readDreamRuns, readRecallEvents, type MemoryDashboardSource, type SearchHit } from "../pi-memory/src/dashboard-data.ts";

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

/** Plain text cut to `width` terminal columns (emoji count 2), before any color is applied. */
export function clip(text: string, width: number): string {
	let used = 0;
	let out = "";
	for (const char of text) {
		const cells = /\p{Extended_Pictographic}/u.test(char) ? 2 : 1;
		if (used + cells > width) return `${out.slice(0, -1)}…`;
		used += cells;
		out += char;
	}
	return out;
}

/** Minimal shape of pi-picker's pick(), imported at run time (pi-memory does not depend on pi-picker). */
type Pick = (ctx: ExtensionContext, options: { title: string; source: { start: string; list: () => { value: string; label: string }[]; describe?: () => string }; preview?: (item: { value: string }) => string | undefined; wrapPreview?: boolean }) => Promise<string[] | undefined>;
const PICKER = "../pi-picker/src/pick.ts";

/** Project and global records together, global ids prefixed "g:" (as the recaller does). */
function allRecords(dirs: StoreDirs): MemoryRecord[] {
	return [
		...(storeExists(dirs.project) ? loadStore(dirs.project).records : []),
		...(dirs.global && storeExists(dirs.global) ? loadStore(dirs.global, "g:").records : []),
	];
}
const totals = (records: MemoryRecord[]) => {
	const active = records.filter((record) => record.status === "active");
	return { active: active.length, pinned: active.filter((record) => record.pinned).length };
};

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

/** The memory worker of the running extension (model, index, recall), shared with the dashboard source. */
let shared: MemoryWorker | undefined;

/**
 * Data for the memory dashboard (pi-memory/src/dashboard-tui.ts): project + global records ("g:" ids), /dream and recall
 * history, local search (no tokens), the model's answer from memories only, and the actions on a memory.
 */
export function dashboardSource(ctx: ExtensionContext): MemoryDashboardSource {
	const dirs = deepDirs(ctx.cwd);
	return {
		load: () => ({
			records: allRecords(dirs),
			runs: [...readDreamRuns(dirs.project), ...(dirs.global ? readDreamRuns(dirs.global) : [])].sort((a, b) => b.at.localeCompare(a.at)),
			events: readRecallEvents(dirs.project),
			lastDream: readState(projectFiles(ctx.cwd).state).lastConsolidated?.slice(0, 10),
			where: `.pi/memory${dirs.global && storeExists(dirs.global) ? " + globale" : ""}`,
		}),
		search: async (question) => {
			if (!hasStore(dirs)) return [];
			const memory = shared ?? new MemoryWorker();
			// A question about the memory is an inquiry: no raised threshold here, and more results than a request gets.
			const run = await memory.recall(question, dirs, today(), { includeSuperseded: true, threshold: 0.2, inquiryThreshold: 0, limit: 20 });
			return run.hits.map((hit): SearchHit => ({ record: hit.record, score: hit.score }));
		},
		answer: async (question, hits, onText, signal) => {
			const model = ctx.modelRegistry.find("claude-code", process.env.PI_DREAM_MODEL ?? "haiku") ?? ctx.model;
			if (!model) throw new Error("nessun modello disponibile");
			const stream = ctx.modelRegistry.streamSimple(model, {
				systemPrompt: "Rispondi solo con le informazioni dei ricordi forniti, citandoli con il loro id. Se non bastano, dillo.",
				messages: [{ role: "user", content: [{ type: "text", text: answerPrompt(question, hits) }], timestamp: Date.now() }],
			} as never, { signal } as never);
			let text = "";
			for await (const event of stream as AsyncIterable<{ type: string; delta?: string }>) {
				if (signal?.aborted) break;
				if (event.type === "text_delta" && event.delta) {
					text += event.delta;
					onText(text);
				}
			}
			const message = await stream.result();
			const final = message.content.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join("") || text;
			if (final !== text) onText(final);
			return final;
		},
		act: async (id, action) => {
			const global = id.startsWith("g:");
			const dir = global ? dirs.global : dirs.project;
			if (!dir || !storeExists(dir)) return;
			const store = loadStore(dir);
			const next = applyAction(store.records, global ? id.slice(2) : id, action, today());
			saveStore(dir, { records: next, vectors: pruneVectors(store.records, next, store.vectors), model: store.model });
			// An edited text needs its embedding again to be recalled semantically.
			if (shared?.ready) await shared.fillVectors(dir).catch(() => 0);
		},
	};
}

/**
 * The project's memory (.pi/) stays out of git without touching the project's .gitignore: a line in the local
 * .git/info/exclude (never committed). Projects outside git are left alone.
 */
export function ensureLocalIgnore(cwd: string): void {
	try {
		let dir = cwd;
		while (!existsSync(join(dir, ".git"))) {
			const parent = dirname(dir);
			if (parent === dir) return;
			dir = parent;
		}
		const exclude = join(dir, ".git", "info", "exclude");
		const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
		if (current.split("\n").some((line) => line.trim() === "/.pi/" || line.trim() === ".pi/" || line.trim() === ".pi")) return;
		mkdirSync(dirname(exclude), { recursive: true });
		writeFileSync(exclude, `${current}${current && !current.endsWith("\n") ? "\n" : ""}# Pi: memory and state of this project, in any folder (pi-claude)\n.pi/\n`);
	} catch {
		// Best effort.
	}
}

/**
 * Whether to run /dream by itself at startup: memory was empty in projects where nobody remembered to run it (a
 * project with 24 sessions had none). Once a day, with new sessions, in the interactive UI only, unless switched off.
 */
export function shouldAutoDream(input: { today: string; lastAutoDream?: string; newSessions: number; hasUI: boolean; env: Record<string, string | undefined> }): boolean {
	if (input.env.PI_MEMORY_AUTODREAM === "0" || !input.hasUI) return false;
	return input.newSessions > 0 && input.lastAutoDream !== input.today;
}

export default function (pi: ExtensionAPI) {
	// Model, index and recall in a worker thread: Pi's interface never builds an index or waits for one.
	const memoryWorker = new MemoryWorker();
	shared = memoryWorker;
	const logRecall = process.env.PI_MEMORY_RECALL_LOG === "1";
	/** Footer/panel line about memory (pi-ui shows it): loading, consolidating, or how many memories and recalled. */
	const showStatus = (ctx: ExtensionContext, extra: { loading?: boolean; dreaming?: boolean; recalled?: number } = {}) => {
		if (!ctx.hasUI) return;
		try {
			const counts = deepMode() ? totals(allRecords(deepDirs(ctx.cwd))) : { active: parseMemory(read(projectFiles(ctx.cwd).memory)).length, pinned: 0 };
			ctx.ui.setStatus("memory", memoryStatus({ ...counts, ...extra }));
		} catch {
			// A store being written by /dream in another session: try again at the next event.
		}
	};

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
		const core = await memoryWorker.core(dirs);
		if (core) event.systemPromptOptions.sections.memory = core;
		// "procedi", "ok": nothing to recall (the pinned core above still holds).
		if (isSmallTalk(event.prompt)) return void log([], 0, memoryWorker.ready);
		// Without a UI (pi -p) nobody waits for a background load: give the model a few seconds so recall is semantic.
		const run = await memoryWorker.recall(event.prompt, dirs, date, { waitModelMs: ctx.hasUI ? undefined : 8000 });
		log(run.ids, run.chars, run.embedderReady);
		// Always kept (last 500): the dashboard shows what was recalled, when and with which score.
		try {
			const injected = new Set(run.ids);
			appendRecallEvent(dirs.project, { at: new Date().toISOString(), query: event.prompt.slice(0, 300), hits: run.hits.filter((hit) => injected.has(hit.record.id)).map((hit) => ({ id: hit.record.id, score: Math.round(hit.score * 1000) / 1000 })), ms: run.ms });
		} catch {
			// A read-only project folder must not break the request.
		}
		showStatus(ctx, { recalled: run.ids.length });
		if (!run.text) return;
		return { message: { customType: "memory-recall", content: recallMessage(run.text, event.prompt), display: false } };
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
	// Automatic /dream: a few seconds after startup (never slowing it), once a day, when there are new sessions.
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		setTimeout(() => {
			try {
				const marker = join(ctx.cwd, ".pi", "memory-autodream");
				const lastAutoDream = existsSync(marker) ? readFileSync(marker, "utf8").trim() : undefined;
				const since = readState(projectFiles(ctx.cwd).state).lastConsolidated ?? "";
				let exclude: string | undefined;
				try {
					exclude = ctx.sessionManager.getSessionFile();
				} catch {}
				const newSessions = lookbackBatch(sessionFiles(ctx), { since, maxChars: LOOKBACK_CHARS, exclude }).text ? 1 : 0;
				if (!shouldAutoDream({ today: today(), lastAutoDream, newSessions, hasUI: ctx.hasUI, env: process.env })) return;
				write(marker, `${today()}\n`);
				showStatus(ctx, { dreaming: true });
				// Up to 3 batches (a project with many sessions); the rest on the next day or with /dream.
				void (async () => {
					for (let run = 0; run < 3; run++) {
						await dream("", ctx, { auto: true });
						let pending = 0;
						try {
							pending = JSON.parse(readFileSync(projectFiles(ctx.cwd).last, "utf8")).pending ?? 0;
						} catch {}
						if (!pending) break;
					}
				})()
					.catch(() => {})
					.finally(() => showStatus(ctx));
			} catch {
				// Memory is best effort: never disturb the session.
			}
		}, 6000).unref?.();
	});

	pi.on("session_start", (_event, ctx) => {
		// Deep mode: load the embedding model in the background, after startup, only if there is memory to recall.
		if (deepMode() && ctx.hasUI) {
			const dirs = deepDirs(ctx.cwd);
			migrate(ctx.cwd, today());
			if (hasStore(dirs)) {
				showStatus(ctx, { loading: true });
				setTimeout(() => {
					// The keyword index first (in the worker), then the model, missing vectors and the vector index.
					void memoryWorker.warm(dirs).catch(() => 0);
					void memoryWorker.start().then(async (ready) => {
						showStatus(ctx);
						if (!ready) return;
						for (const dir of [dirs.project, dirs.global]) if (dir && storeExists(dir)) await memoryWorker.fillVectors(dir).catch(() => 0);
						await memoryWorker.warm(dirs).catch(() => 0);
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

	pi.registerEntryRenderer<DreamEntry>("memory-dream", (entry, _options, theme) => ({
		render: (width: number) => {
			const data = entry.data;
			if (!data) return [];
			const color = (line: string) => (line.startsWith("+") ? "success" : line.startsWith("−") ? "error" : line.startsWith("↑") ? "accent" : "text");
			return [
				"",
				` ${theme.fg("accent", "◆")} ${theme.bold(theme.fg("text", clip(data.title, width - 3)))}`,
				...data.lines.slice(0, 12).map((line) => `   ${theme.fg(color(line), clip(line, width - 3))}`),
				...(data.lines.length > 12 ? [`   ${theme.fg("muted", `… altre ${data.lines.length - 12}`)}`] : []),
				...(data.footer ? [`   ${theme.fg("dim", clip(data.footer, width - 3))}`] : []),
			];
		},
		invalidate() {},
	}));

	pi.registerCommand("dream", {
		description: "Consolida le sessioni passate nella memoria (come il sonno): /dream · /dream --global per le preferenze personali",
		handler: async (args, ctx) => {
			showStatus(ctx, { dreaming: true });
			try {
				await dream(args, ctx);
			} finally {
				showStatus(ctx);
			}
		},
	});

	const dream = async (args: string, ctx: ExtensionContext, options: { auto?: boolean } = {}) => {
		const global = /--global\b/.test(args);
		const globalTarget = globalFiles();
		if (global && !globalTarget) return ctx.ui.notify("Memoria globale disattivata (PI_MEMORY_GLOBAL_PATH vuota).", "warning");
		const target = global ? globalTarget! : projectFiles(ctx.cwd);
		ensureLocalIgnore(ctx.cwd);
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
		// What to keep is checked by code too: additions without content dropped, near-twins turned into confirmations.
		const filtered = deep ? filterProposal(parsed.proposal, memory) : { proposal: parsed.proposal, dropped: [] as string[] };
		const proposal = filtered.proposal;
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
		if (!options.auto && process.env.PI_DREAM_AUTO_APPROVE !== "1") {
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
		let lifecycleNote = "";
		if (deep && previous) {
			deepRecords = entriesToRecords(result.memory, result.archive, previous.records, date);
			// Long term: what was recalled counts as used; unused memories go dormant, then are forgotten (kept aside).
			if (process.env.PI_MEMORY_FORGET !== "0") {
				const sinceFile = join(storeDir, "usage-since");
				const events = readRecallEvents(dirs.project);
				deepRecords = applyUsage(deepRecords, events, global ? "g:" : "", existsSync(sinceFile) ? readFileSync(sinceFile, "utf8").trim() : "");
				if (events.length) write(sinceFile, `${events[events.length - 1].at}\n`);
				const cycle = lifecycle(deepRecords, date, { fileExists: global ? undefined : (path) => existsSync(join(ctx.cwd, path)) });
				deepRecords = cycle.records;
				if (cycle.forgotten.length) appendFileSync(join(storeDir, "forgotten.jsonl"), cycle.forgotten.map((record) => `${JSON.stringify({ ...record, forgottenAt: date })}\n`).join(""));
				lifecycleNote = [cycle.dormant.length ? `${cycle.dormant.length} addormentati` : "", cycle.woken.length ? `${cycle.woken.length} risvegliati` : "", cycle.forgotten.length ? `${cycle.forgotten.length} dimenticati (recuperabili)` : ""].filter(Boolean).join(" · ");
			}
			// Personal preferences found in a project's sessions hold everywhere: to the global store.
			if (!global && dirs.global) {
				const globalStore = storeExists(dirs.global) ? loadStore(dirs.global) : { records: [], vectors: new Map<string, Float32Array>() };
				const split = movePersonal(deepRecords, globalStore.records);
				if (split.moved) {
					deepRecords = split.project;
					saveStore(dirs.global, { ...globalStore, records: split.global });
					lifecycleNote = [lifecycleNote, `${split.moved} nella memoria personale`].filter(Boolean).join(" · ");
				}
			}
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
		// History of /dream runs for the dashboard (what each run saved, when, at what cost).
		try {
			const usage = answer.usage as { input?: number; output?: number } | undefined;
			appendDreamRun(storeDir, { at: new Date().toISOString(), date, scope: global ? "globale" : "progetto", counts: result.counts, lines: describe(memory, approved), tokens: usage ? (usage.input ?? 0) + (usage.output ?? 0) : undefined });
		} catch {
			// Logging must never undo a consolidation.
		}
		const { added, reinforced, merged, updated, forgotten } = result.counts;
		if (deep) {
			// New or edited memories get their embedding now, so the next request can recall them semantically.
			ctx.ui.notify("Calcolo gli embedding dei ricordi nuovi…", "info");
			if (await memoryWorker.start()) await memoryWorker.fillVectors(storeDir).catch(() => 0);
			// The result stays in the chat (a notification disappears and leaves the user unsure it was saved).
			const active = deepRecords?.filter((record) => record.status === "active") ?? [];
			pi.appendEntry("memory-dream", dreamEntry(result.counts, [...describe(memory, approved), ...filtered.dropped.slice(0, 3), ...(lifecycleNote ? [`… ${lifecycleNote}`] : [])], { active: active.length, pinned: active.filter((record) => record.pinned).length, pending: batch.pending }));
			return ctx.ui.notify(`${options.auto ? "Memoria aggiornata in automatico (/memory per vederla)" : "Memoria aggiornata"}: +${added} nuovi, ${reinforced} rinforzati, ${merged} uniti, ${updated} aggiornati (superati), ${forgotten} dimenticati · ${deepRecords?.filter((record) => record.status === "active").length ?? 0} ricordi attivi, nessun tetto${batch.pending ? ` · restano ${batch.pending} sessioni: rilancia /dream` : ""}`, "info");
		}
		pi.appendEntry("memory-dream", dreamEntry(result.counts, describe(memory, approved), { active: result.memory.length, pinned: result.memory.filter((entry) => entry.pinned).length, pending: batch.pending }));
		ctx.ui.notify(`${options.auto ? "Memoria aggiornata in automatico (/memory per vederla)" : "Memoria aggiornata"}: +${added} nuovi, ${reinforced} rinforzati, ${merged} uniti, ${updated} aggiornati, ${forgotten} dimenticati${capped.moved ? `, ${capped.moved} archiviati per spazio` : ""} · ${result.memory.length} ricordi (~${summary.contextTokens} token in contesto)${batch.pending ? ` · restano ${batch.pending} sessioni: rilancia /dream` : ""}`, "info");
	};

	/** /memory: summary on top, every memory with its preview; Enter → pin, edit, mark superseded or delete. */
	pi.registerCommand("memory", {
		description: "Dashboard della memoria: ricordi, cronologia dei /dream, richiami, e domande alla memoria",
		handler: async (_args, ctx) => {
			if (!deepMode()) return ctx.ui.notify("La dashboard serve la memoria profonda (il default; ora PI_MEMORY_MODE=capped): i ricordi sono in .pi/memory.md.", "info");
			migrate(ctx.cwd, today());
			const source = dashboardSource(ctx);
			if (ctx.mode !== "tui") {
				const data = source.load();
				return ctx.ui.notify(summarize(data.records, { lastDream: data.lastDream, where: data.where }), "info");
			}
			// Modal over the chat; "e" closes it to open Pi's editor, then the dashboard comes back on the same view.
			const { MemoryDashboard } = await import("../pi-memory/src/dashboard-tui.ts");
			let view: View = "ricordi";
			for (;;) {
				const result = await ctx.ui.custom<DashboardResult>(
					(tui, theme, _keybindings, done) =>
						new MemoryDashboard(source, { fg: (role, text) => theme.fg(role, text), bg: (role, text) => theme.bg(role, text), bold: (text) => theme.bold(text) }, done, () => tui.requestRender(), () => Math.max(14, Math.floor((process.stdout.rows || 30) * 0.92)), today(), view),
					{ overlay: true, overlayOptions: { anchor: "center", width: "96%", maxHeight: "94%" } },
				);
				if (!result) return;
				view = result.view;
				const text = await ctx.ui.editor("Modifica il ricordo", result.edit.text);
				if (text?.trim() && text.trim() !== result.edit.text) await source.act(result.edit.id, { kind: "edit", text: text.trim() });
			}
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
				const run = await memoryWorker.recall(query, dirs, today(), { includeSuperseded: true, threshold: 0.25, waitModelMs: 8000 });
				if (run.hits.length === 0) return ctx.ui.notify("Nessun ricordo trovato.", "info");
				const lines = run.hits.map(({ record }) => `- [${record.type}] ${record.text}${record.status === "superseded" ? ` (superato${record.reason ? `: ${record.reason}` : ""})` : record.forgottenAt ? ` (dimenticato il ${record.forgottenAt})` : record.state === "dormant" ? " (dormiente)" : ""}`).join("\n");
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
