/**
 * Lean tools (docs/specs/2026-10-08-lean-tools-design.md): fewer tokens to find and read code, same information.
 * - search: ripgrep grouped by file, capped with counts; files: true finds file names; semantic: true searches by meaning
 * - outline: a file's skeleton, or one symbol's body
 * - re-reads of unchanged files become a short note (until the next compaction)
 * - long bash outputs: head/tail with the full output on disk; test runs: failures + summary
 * PI_LEAN=0 turns everything off; PI_LEAN_REREAD/BASH=0 turn off one part; PI_LEAN_SEARCH/OUTLINE=1 add the tools
 * (off by default: measured not worth their fixed cost), PI_LEAN_SEMANTIC=1 the semantic mode of search.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { compactBash, regroupGrep } from "./lean/bash.ts";
import { formatOutline, outline, symbolBody } from "./lean/outline.ts";
import { ReadTracker } from "./lean/reread.ts";
import { formatMatches, parseRgJson, rankFiles } from "./lean/search.ts";
import { CodeIndex } from "./lean/semantic.ts";

// Measured (eval/LEAN-REPORT.md): the model rarely calls new tools, and each costs on every request. The zero-cost
// parts (re-reads, bash compaction, grep regrouping) are on; search and outline only when asked for (=1).
const OPT_IN = new Set(["SEARCH", "OUTLINE", "SEMANTIC"]);
const on = (part: string) => process.env.PI_LEAN !== "0" && (OPT_IN.has(part) ? process.env[`PI_LEAN_${part}`] === "1" : process.env[`PI_LEAN_${part}`] !== "0");
const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|cs|swift|scala|c|cc|cpp|h|hpp)$/;

function run(command: string, args: string[], cwd: string, signal?: AbortSignal): Promise<{ stdout: string; code: number }> {
	return new Promise((done) => {
		execFile(command, args, { cwd, signal, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
			const code = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 2) : 0;
			done({ stdout: String(stdout ?? ""), code });
		});
	});
}

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: undefined });

export default function (pi: ExtensionAPI) {
	if (process.env.PI_LEAN === "0") return;
	const tracker = new ReadTracker();
	let embedder: import("../pi-memory/src/embed.ts").Embedder & { ready?: boolean; start?: () => Promise<boolean> } | undefined;
	let index: CodeIndex | undefined;

	if (on("SEARCH")) {
		pi.registerTool({
			name: "search",
			label: "Search",
			description: "Search code (ripgrep, .gitignore respected), grouped by file. Prefer over grep/find in bash. files: match file names; semantic: describe what the code does.",
			parameters: {
				type: "object",
				properties: {
					pattern: { type: "string" },
					path: { type: "string" },
					glob: { type: "string" },
					ignoreCase: { type: "boolean" },
					context: { type: "number" },
					files: { type: "boolean" },
					semantic: { type: "boolean" },
				},
				required: ["pattern"],
			} as never,
			async execute(_id, raw, signal, _update, ctx) {
				const params = raw as { pattern: string; path?: string; glob?: string; ignoreCase?: boolean; literal?: boolean; context?: number; limit?: number; files?: boolean; semantic?: boolean };
				// literal and limit are not advertised (fixed cost); accepted if the model passes them anyway.
				const cwd = ctx.cwd;
				const root = params.path ? resolve(cwd, params.path) : cwd;
				const shown = (path: string) => relative(cwd, resolve(root, path)) || path;
				if (params.files) {
					const listed = await run("rg", ["--files", ...(params.glob ? ["-g", params.glob] : []), "."], root, signal);
					const ranked = rankFiles(listed.stdout.split("\n").filter(Boolean).map((path) => path.replace(/^\.\//, "")), params.pattern);
					const limit = params.limit ?? 50;
					if (!ranked.length) return text(`Nessun file corrisponde a "${params.pattern}".`);
					return text([...ranked.slice(0, limit).map(shown), ...(ranked.length > limit ? [`… e altri ${ranked.length - limit} file`] : [])].join("\n"));
				}
				if (params.semantic && on("SEMANTIC")) {
					const hits = await semanticSearch(cwd, params.pattern, params.limit ?? 8);
					if (hits) return text(hits.length ? hits.map((hit) => `${hit.path}:${hit.line}  ${hit.name || "(file)"}`).join("\n") : "Nessun risultato semantico.");
					// Model not ready yet: fall back to a text search and say so.
				}
				const args = ["--json", "--max-columns", "400", ...(params.ignoreCase ? ["-i"] : []), ...(params.literal || params.semantic ? ["-F"] : []), ...(params.context ? ["-C", String(params.context)] : []), ...(params.glob ? ["-g", params.glob] : []), "-e", params.semantic ? params.pattern.split(/\s+/)[0] : params.pattern, "."];
				const result = await run("rg", args, root, signal);
				if (result.code === 2 && !result.stdout) return { ...text(`ripgrep non disponibile o pattern non valido: usa bash.`), isError: true };
				const matches = parseRgJson(result.stdout).map((match) => ({ ...match, path: shown(match.path.replace(/^\.\//, "")) }));
				if (!matches.length) return text(`Nessun risultato per ${JSON.stringify(params.pattern)}.`);
				const note = params.semantic ? "(ricerca semantica non pronta: risultati testuali)\n" : "";
				return text(note + formatMatches(matches, { total: params.limit ?? 60 }));
			},
		});
	}

	/** Semantic search over the project's symbols; undefined while the local model is not ready. */
	async function semanticSearch(cwd: string, query: string, k: number) {
		if (!embedder) {
			const { BackgroundEmbedder, MODELS } = await import("../pi-memory/src/embed.ts");
			embedder = new BackgroundEmbedder(MODELS.e5);
			void embedder.start?.();
		}
		if (embedder.ready === false) return undefined;
		const indexPath = join(cwd, ".pi", "code-index.json");
		if (!index) {
			try {
				index = CodeIndex.fromJSON(JSON.parse(readFileSync(indexPath, "utf8")));
			} catch {
				index = new CodeIndex();
			}
		}
		const listed = await run("rg", ["--files"], cwd);
		const files = listed.stdout.split("\n").filter((path) => CODE_FILE.test(path)).slice(0, 3000).flatMap((path) => {
			try {
				const stats = statSync(join(cwd, path));
				return stats.size > 300_000 ? [] : [{ path, mtime: stats.mtimeMs, source: readFileSync(join(cwd, path), "utf8") }];
			} catch {
				return [];
			}
		});
		try {
			if (await index.update(files, embedder)) {
				mkdirSync(dirname(indexPath), { recursive: true });
				writeFileSync(indexPath, JSON.stringify(index.toJSON()));
			}
			return await index.search(query, embedder, k);
		} catch {
			return undefined;
		}
	}

	if (on("OUTLINE")) {
		pi.registerTool({
			name: "outline",
			label: "Outline",
			description: "Skeleton of a code file (symbols with line ranges); with symbol, only that symbol's code. Use before reading big files.",
			parameters: { type: "object", properties: { path: { type: "string" }, symbol: { type: "string" } }, required: ["path"] } as never,
			async execute(_id, raw, _signal, _update, ctx) {
				const params = raw as { path: string; symbol?: string };
				const file = resolve(ctx.cwd, params.path);
				let source: string;
				try {
					source = readFileSync(file, "utf8");
				} catch {
					return { ...text(`File non trovato: ${params.path}`), isError: true };
				}
				if (params.symbol) {
					const body = symbolBody(source, file, params.symbol);
					const names = outline(source, file).map((symbol) => symbol.name).slice(0, 30).join(", ");
					return body ? text(body) : { ...text(`Simbolo "${params.symbol}" non trovato in ${params.path}. Simboli: ${names || "nessuno"}`), isError: true };
				}
				const symbols = outline(source, file);
				return text(symbols.length ? formatOutline(symbols, source.split("\n").length) : `${source.split("\n").length} righe, nessun simbolo riconosciuto: usa read.`);
			},
		});
	}

	if (on("REREAD")) {
		for (const event of ["session_compact", "session_tree", "session_start"] as const) pi.on(event, () => tracker.reset());
	}

	/** Tokens saved (estimated: characters / 3.6), for pi-ui's panel. */
	const report = (before: string, after: string) => {
		const tokens = Math.round((before.length - after.length) / 3.6);
		if (tokens > 0) pi.events.emit("lean:saved", { tokens });
	};

	pi.on("tool_result", (event) => {
		if (event.isError) {
			if (event.toolName !== "bash") return undefined;
		}
		const body = event.content.filter((block) => block.type === "text").map((block) => (block as { text: string }).text).join("\n");
		if (event.toolName === "read" && on("REREAD") && !event.content.some((block) => block.type === "image")) {
			const input = event.input as { path?: string; offset?: number; limit?: number };
			const note = tracker.check({ path: String(input.path ?? ""), offset: input.offset, limit: input.limit, content: body, minChars: 400 });
			if (note) report(body, note);
			return note ? { content: [{ type: "text", text: note }] } : undefined;
		}
		if (event.toolName === "bash" && on("BASH")) {
			const details = event.details as { fullOutputPath?: string } | undefined;
			let fullOutputPath = details?.fullOutputPath;
			// Pi truncated to the last 50 KB: compact the whole output it saved (the summary and first failures are there).
			let source = body;
			if (fullOutputPath) {
				try {
					source = readFileSync(fullOutputPath, "utf8");
				} catch {}
			}
			const command = String((event.input as { command?: string }).command ?? "");
			// grep/rg output: regrouped by file without losing a line (the path once instead of on every line).
			const regrouped = event.isError ? undefined : regroupGrep(source, command);
			if (regrouped !== undefined) source = regrouped;
			const compacting = () => compactBash(source, { command, exitCode: event.isError ? 1 : 0, fullOutputPath });
			let compact = compacting();
			if (compact === undefined) {
				if (regrouped !== undefined) report(body, regrouped);
				return regrouped === undefined ? undefined : { content: [{ type: "text", text: regrouped }] };
			}
			if (!fullOutputPath && compact.includes("righe omesse")) {
				// Keep the full output reachable: write it where the model can read ranges of it.
				fullOutputPath = join(mkdtempSync(join(tmpdir(), "pi-lean-")), "output.log");
				writeFileSync(fullOutputPath, source);
				compact = compacting();
			}
			if (compact !== undefined) report(body, compact);
			return compact === undefined ? undefined : { content: [{ type: "text", text: compact }] };
		}
		return undefined;
	});
	void existsSync;
}
