/**
 * Which of Pi's own tools an auto mode step gets on top of read/bash/edit/write, decided in code like the skills
 * (auto/skills.ts): every extra tool costs its description on every request of the step, so it is on only when the
 * step needs it.
 * - browser (pi-browser, visible Chrome) + lancia: a step about a UI or a web page, to start the app in background
 *   and look at it. Only localhost/file: pages open (no one can confirm a site); bash and lancia keep the host
 *   network in that step, because a sandbox with its own network namespace would hide the server from Chrome.
 * - lancia alone: a step about a server or a long job.
 * - search/outline (lean-tools) and graph_*: a big repository, where grep/find waste tokens. The supervisor builds
 *   the graph statically (0 tokens) before the step.
 */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { StepKind } from "./skills.ts";

const ext = (name: string) => fileURLToPath(new URL(`../${name}`, import.meta.url));
export const EXTENSIONS = { browser: ext("browser.ts"), jobs: ext("jobs.ts"), lean: ext("lean-tools.ts"), graph: ext("graph.ts") };

export type ToolGroup = "browser" | "lancia" | "search" | "graph";

export interface StepTools {
	groups: ToolGroup[];
	/** Extra names for --tools, an allowlist (lancia is then turned on by jobs.ts through PI_JOBS=1). */
	names: string[];
	extensions: string[];
	env: Record<string, string>;
	/** bash/lancia keep the host network (browser steps: Chrome must reach the app on localhost). */
	localNetwork: boolean;
}

const UI = /\b(ui|interfaccia grafica|schermat\w*|pagin[ae]( web)?|sito|frontend|html|css|react|vue|svelte|tailwind|layout|pulsant\w*|form|browser|dom|web ?app|localhost)\b|\.(html|css|scss|tsx|jsx|vue|svelte)\b/i;
const SERVER = /\b(server|servizio|porta \d+|port \d+|dev server|watch|daemon|websocket|api|endpoint\w*|http)\b/i;
const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|cs|swift|scala|c|cc|cpp|h|hpp|vue|svelte)$/;
/** Code files from which grep/find stop being enough (PI_AUTO_BIG_REPO). */
export const BIG_REPO = Number(process.env.PI_AUTO_BIG_REPO) || 150;
const WORK: StepKind[] = ["build", "retry", "review"];

export function codeFiles(worktree: string): number {
	try {
		return execFileSync("git", ["ls-files"], { cwd: worktree, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter((file) => CODE_FILE.test(file)).length;
	} catch {
		return 0;
	}
}

/** Pure choice: step kinds, the step context (goal, requirement, design, changed files) and the repo size. */
export function chooseTools(kinds: StepKind[], context: string, files: number): ToolGroup[] {
	const groups: ToolGroup[] = [];
	const working = kinds.some((kind) => WORK.includes(kind));
	if (working && UI.test(context)) groups.push("browser", "lancia");
	else if (working && SERVER.test(context)) groups.push("lancia");
	if (files >= BIG_REPO && kinds.some((kind) => kind === "plan" || WORK.includes(kind))) groups.push("search", "graph");
	return groups;
}

export function toolsFor(groups: ToolGroup[]): StepTools {
	const tools: StepTools = { groups, names: [], extensions: [], env: {}, localNetwork: false };
	if (groups.includes("browser")) {
		tools.names.push("browser");
		tools.extensions.push(EXTENSIONS.browser);
		// Own profile: the user's pi-browser may be open on the default one (profile lock).
		Object.assign(tools.env, { PI_BROWSER: "1", PI_BROWSER_PROFILE: process.env.PI_AUTO_BROWSER_PROFILE ?? join(homedir(), ".cache", "pi-browser", "auto") });
		tools.localNetwork = true;
	}
	if (groups.includes("lancia")) {
		tools.names.push("lancia");
		tools.extensions.push(EXTENSIONS.jobs);
		tools.env.PI_JOBS = "1";
	}
	if (groups.includes("search")) {
		tools.names.push("search", "outline");
		tools.extensions.push(EXTENSIONS.lean);
		Object.assign(tools.env, { PI_LEAN: "1", PI_LEAN_SEARCH: "1", PI_LEAN_OUTLINE: "1", PI_LEAN_SEMANTIC: "0" });
	}
	if (groups.includes("graph")) {
		tools.names.push("graph_query", "graph_explain", "graph_path");
		tools.extensions.push(EXTENSIONS.graph);
		Object.assign(tools.env, { PI_GRAPH: "1", PI_GRAPH_ENGINE: "custom" });
	}
	return tools;
}

/** Static graph of the worktree (0 tokens), refreshed from the previous one; it lives in a gitignored folder. */
export async function buildStaticGraph(worktree: string): Promise<void> {
	const { buildGraph, scanProject } = await import("../graph/engine.ts");
	const { loadGraph, saveGraph } = await import("../graph.ts");
	saveGraph(worktree, buildGraph(scanProject(worktree), loadGraph(worktree)).graph);
}

/** One short system prompt note, only for the groups that change how the step should work. */
export function toolsNote(groups: ToolGroup[]): string {
	const lines: string[] = [];
	if (groups.includes("browser"))
		lines.push("- browser: avvia l'app con lancia, aprila su localhost (siti esterni non permessi) e prova davvero ciò che il requisito chiede; salva gli screenshot utili in auto/.");
	if (groups.includes("lancia")) lines.push("- lancia: per server e job lunghi in background. Muoiono a fine passo: non chiudere il turno aspettando un job, controlla il suo log con read.");
	if (groups.includes("search")) lines.push("- search/outline: preferiscili a grep/find per trovare e leggere codice.");
	if (groups.includes("graph")) lines.push("- graph_query/graph_explain: chi usa un file o simbolo, prima di cambiarlo.");
	return lines.length ? `Strumenti in più in questo passo:\n${lines.join("\n")}` : "";
}
