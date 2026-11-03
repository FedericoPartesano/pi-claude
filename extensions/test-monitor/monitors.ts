/**
 * Monitors for commands that are not test runs: type check, lint, build, install, git and docker. Like the test runners
 * (runners.ts) each one recognises a command and folds the text printed so far into a view state (views.ts); unlike
 * them it never rewrites the command, so the model's output and its token cost stay exactly as they were. The text
 * comes from the tool's own partial output (stdout and stderr merged), which is all Pi has while a command runs.
 *
 * To add one: write `matches` (one command, no pipes), `init` (an empty view) and `update` (re-parse the whole text:
 * it is called again with more text each time, so it must be idempotent), then add it to MONITORS.
 */
import { stripAnsi } from "./progress.ts";
import { newBar, newFeed, newIssues, type BarView, type FeedView, type Issue, type IssuesView, type ViewState } from "./views.ts";

export interface Monitor {
	name: string;
	/** One simple command: env assignments, `npx`, `cd x &&` and pipes are already gone. */
	matches(command: string): boolean;
	init(command: string, now: number): ViewState;
	/** Folds all the text printed so far into the state. */
	update(state: ViewState, text: string): void;
}

/** The commands of a line that could be monitored: split on `&&`, `||` and `;`, pipes and leading noise removed. */
export function simpleCommands(line: string): string[] {
	return line
		.split(/&&|\|\||;/)
		.map((part) => part.split(/(?<!\|)\|(?!\|)/)[0].trim().replace(/^(?:\w+=\S*\s+)+/, "").replace(/^(?:sudo\s+|time\s+)/, "").replace(/^(?:npx|pnpm dlx|bunx)\s+(?:(?:--no-install|--yes|-y)\s+)*/, ""))
		.filter(Boolean);
}

const lines = (text: string) => stripAnsi(text).split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean);
const lastLine = (all: string[]) => all[all.length - 1];

// ---------------------------------------------------------------------------------------------------- type check

const TSC_LINE = /^(.+?)(?:\((\d+),\d+\)|:(\d+):\d+)\s*(?::| -)\s*error\s+(TS\d+):\s*(.+)$/;

/** tsc: only errors are printed (no progress), so the view shows them when they come. */
export function tscUpdate(state: IssuesView, text: string): void {
	const issues: Issue[] = [];
	for (const line of lines(text)) {
		const match = TSC_LINE.exec(line);
		if (match) issues.push({ level: "error", file: match[1], line: Number(match[2] ?? match[3]), rule: match[4], message: match[5] });
	}
	state.issues = issues;
	state.errors = issues.length;
	state.files = new Set(issues.map((issue) => issue.file)).size;
}

// -------------------------------------------------------------------------------------------------------- lint

const ESLINT_ISSUE = /^(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?$/;

/** eslint stylish output: a file path line, then `line:col  level  message  rule` lines. */
export function eslintUpdate(state: IssuesView, text: string): void {
	const issues: Issue[] = [];
	let file: string | undefined;
	let files = 0;
	for (const raw of stripAnsi(text).split("\n")) {
		if (!raw.trim() || /^\s*✖\s/.test(raw)) continue;
		const match = ESLINT_ISSUE.exec(raw.trim());
		if (match && /^\s/.test(raw)) issues.push({ level: match[3] as Issue["level"], file, line: Number(match[1]), message: match[4], rule: match[5] });
		else if (!/^\s/.test(raw) && /[\\/.]/.test(raw.trim()) && !/\s{2,}/.test(raw.trim())) (file = raw.trim(), files++);
	}
	state.issues = issues;
	state.errors = issues.filter((issue) => issue.level === "error").length;
	state.warnings = issues.length - state.errors;
	state.files = files;
	state.current = file;
}

// ------------------------------------------------------------------------------------------------------ build

/** Bundlers and `npm run build`: no common progress format, so the latest line, the errors and a percent if there is one. */
export function buildUpdate(state: BarView, text: string): void {
	const all = lines(text);
	state.errors = all.filter((line) => /^(?:error\b|ERROR\b|✘ \[ERROR\]|.*\berror TS\d+)/.test(line) || /^Error:/.test(line)).length;
	state.warnings = all.filter((line) => /^(?:warn(?:ing)?\b|WARN\b|⚠)/i.test(line)).length;
	let percent: number | undefined;
	for (const line of all) {
		const match = /(?:^|\s)(\d{1,3})%(?:\s|$)/.exec(line);
		if (match) percent = Math.min(100, Number(match[1]));
	}
	if (percent !== undefined) (state.done = percent, state.total = 100);
	const modules = all.map((line) => /(\d+) modules? transformed/.exec(line)).filter(Boolean).pop();
	if (modules && percent === undefined) state.done = Number(modules[1]);
	state.current = lastLine(all);
}

// ---------------------------------------------------------------------------------------------------- install

/** npm, pnpm, yarn, pip: whatever each prints about resolving and fetching; the final `added N packages`. */
export function installUpdate(state: FeedView, text: string): void {
	const all = lines(text);
	let phase: string | undefined;
	let items = 0;
	let added: number | undefined;
	let removed: number | undefined;
	let last: string | undefined;
	for (const line of all) {
		let match: RegExpExecArray | null;
		const gone = /\bremoved (\d+) packages?/.exec(line);
		if (gone) removed = Number(gone[1]);
		if ((match = /^Progress: resolved (\d+)(?:, reused (\d+))?(?:, downloaded (\d+))?(?:, added (\d+))?/.exec(line))) {
			items = Number(match[1]);
			if (match[4]) added = Number(match[4]);
			phase = "installing";
		} else if ((match = /^added (\d+) packages?/.exec(line))) (added = items = Number(match[1]), (phase = "done"));
		else if (/^(?:up to date|changed \d+ packages?)/.test(line)) phase = "done";
		else if ((match = /^\[(\d)\/(\d)\]\s+(.+?)\.*$/.exec(line))) phase = match[3].toLowerCase();
		else if ((match = /^Collecting (\S+)/.exec(line))) (items++, (last = match[1]), (phase = "collecting"));
		else if (/^Installing collected packages/.test(line)) phase = "installing";
		else if ((match = /^Successfully installed (.+)$/.exec(line))) (added = items = match[1].split(/\s+/).length, (phase = "done"));
		else if ((match = /GET \d+ https?:\/\/[^/]+\/(\S+?)(?:\s|$)/.exec(line))) (items++, (last = decodeURIComponent(match[1])), (phase = "fetching"));
		else if (/^(?:npm )?(?:warn|WARN)\b/i.test(line)) last = line;
		else if (/^(?:npm )?(?:error|ERR!)/i.test(line) || /^npm error/.test(line)) last = line;
	}
	state.phase = phase;
	state.items = items;
	state.added = added;
	state.removed = removed;
	state.last = last ?? lastLine(all);
}

// -------------------------------------------------------------------------------------------------------- git

/** git: no progress unless a terminal (adding `--progress` would put the noise in the model's output), so phase and last line. */
export function gitUpdate(state: BarView, text: string): void {
	const all = lines(text);
	state.current = lastLine(all);
	state.errors = all.filter((line) => /^(?:fatal|error):/.test(line)).length;
	let match: RegExpExecArray | null = null;
	for (const line of all) {
		const found = /^(Receiving|Resolving|Writing|Compressing|Counting|Enumerating) (\w+):\s+(\d+)% \((\d+)\/(\d+)\)/.exec(line);
		if (found) match = found;
	}
	if (match) (state.stage = `${match[1].toLowerCase()} ${match[2]}`, (state.done = Number(match[4])), (state.total = Number(match[5])));
}

// ------------------------------------------------------------------------------------------------------ docker

/** BuildKit plain output (`#5 [3/7] RUN npm ci`, `#5 DONE 3.2s`, `#5 CACHED`) and the classic `Step 3/7 : RUN …`. */
export function dockerBuildUpdate(state: BarView, text: string): void {
	const all = lines(text);
	const names = new Map<string, string>();
	const finished = new Set<string>();
	let classic: [number, number] | undefined;
	for (const line of all) {
		let match: RegExpExecArray | null;
		if ((match = /^#(\d+)\s+(?:DONE\b|CACHED\b)/.exec(line))) finished.add(match[1]);
		else if ((match = /^#([1-9]\d*)\s+(\S.*)$/.exec(line))) {
			if (!names.has(match[1])) names.set(match[1], match[2]);
		}
		else if ((match = /^Step (\d+)\/(\d+)\s*:\s*(.+)$/.exec(line))) (classic = [Number(match[1]), Number(match[2])], names.set("c", `[${match[1]}/${match[2]}] ${match[3]}`));
	}
	const steps = [...names.keys()].filter((id) => id !== "c");
	if (classic) (state.done = classic[0] - 1, (state.total = classic[1]));
	else (state.done = steps.filter((id) => finished.has(id)).length, (state.total = steps.length || undefined));
	const running = classic ? names.get("c") : [...steps].reverse().find((id) => !finished.has(id)) !== undefined ? names.get([...steps].reverse().find((id) => !finished.has(id))!) : undefined;
	const shown = running ?? lastLine(all) ?? "";
	const split = /^(\[[^\]]+\])\s*(.*)$/.exec(shown);
	state.stage = split?.[1];
	state.current = split ? split[2] : shown;
	state.errors = all.filter((line) => /^(?:#\d+\s+)?ERROR\b|^failed to solve|^error:/i.test(line)).length;
}

/** `docker pull`: a line per layer (`abc123: Pulling fs layer` … `Pull complete` / `Already exists`). */
export function dockerPullUpdate(state: BarView, text: string): void {
	const all = lines(text);
	const layers = new Set<string>();
	const complete = new Set<string>();
	for (const line of all) {
		const match = /^([0-9a-f]{6,}):\s+(.+)$/.exec(line);
		if (!match) continue;
		layers.add(match[1]);
		if (/^(?:Pull complete|Already exists)/.test(match[2])) complete.add(match[1]);
	}
	state.total = layers.size || undefined;
	state.done = complete.size;
	const verb = [...all].reverse().map((line) => /^[0-9a-f]{6,}:\s+(Downloading|Extracting|Verifying Checksum|Download complete|Waiting|Pulling fs layer)/.exec(line)?.[1]).find(Boolean);
	state.stage = verb?.toLowerCase();
	state.current = lastLine(all);
	state.errors = all.filter((line) => /^Error\b|error response/i.test(line)).length;
}

// --------------------------------------------------------------------------------------------------- registry

const sub = (command: string, tool: string, verbs: string) => new RegExp(`^${tool}(?:\\s+--?\\S+(?:\\s+\\S+)?)*?\\s+(?:${verbs})(?:\\s|$)`).test(command);
const script = (command: string, names: string) => new RegExp(`^(?:npm|pnpm|yarn|bun)(?:\\s+run)?\\s+(?:${names})(?:\\s|$)`).test(command);
const noWatch = (command: string) => !/(?:^|\s)(?:--watch|-w|--help|-h|--version|-v)(?:\s|$)/.test(command);

export const MONITORS: Monitor[] = [
	{
		name: "tsc",
		matches: (command) => (/^tsc(?:\s|$)/.test(command) && noWatch(command)) || script(command, "typecheck|type-check|tsc|check-types"),
		init: (command, now) => newIssues(command, now, "TYPECHECK"),
		update: (state, text) => state.kind === "issues" && tscUpdate(state, text),
	},
	{
		name: "eslint",
		matches: (command) => (/^eslint(?:\s|$)/.test(command) && noWatch(command)) || script(command, "lint"),
		init: (command, now) => newIssues(command, now, "LINT"),
		update: (state, text) => state.kind === "issues" && eslintUpdate(state, text),
	},
	{
		name: "install",
		matches: (command) => sub(command, "(?:npm|pnpm|yarn|bun)", "install|i|ci|add|update|upgrade") || /^pip3?\s+install\b/.test(command) || /^yarn\s*$/.test(command),
		init: (command, now) => newFeed(command, now, "INSTALL"),
		update: (state, text) => state.kind === "feed" && installUpdate(state, text),
	},
	{
		name: "git",
		matches: (command) => sub(command, "git", "clone|fetch|pull|push"),
		init: (command, now) => ({ ...newBar(command, now, "GIT"), stage: /\bgit\b.*?\b(clone|fetch|pull|push)\b/.exec(command)?.[1] }),
		update: (state, text) => state.kind === "bar" && gitUpdate(state, text),
	},
	{
		name: "docker-build",
		matches: (command) => /^docker(?:\s+buildx)?\s+build\b/.test(command) || /^docker\s+compose\s+build\b/.test(command) || /^docker-compose\s+build\b/.test(command),
		init: (command, now) => newBar(command, now, "DOCKER BUILD"),
		update: (state, text) => state.kind === "bar" && dockerBuildUpdate(state, text),
	},
	{
		name: "docker-pull",
		matches: (command) => /^docker\s+(?:image\s+)?pull\b/.test(command) || /^docker\s+compose\s+pull\b/.test(command),
		init: (command, now) => newBar(command, now, "DOCKER PULL"),
		update: (state, text) => state.kind === "bar" && dockerPullUpdate(state, text),
	},
	{
		name: "build",
		matches: (command) => (/^(?:vite|next|webpack|rollup|esbuild|tsup|turbo|parcel|nuxt|astro|ng)\s+(?:run\s+)?build\b/.test(command) && noWatch(command)) || /^(?:cargo|go)\s+build\b/.test(command) || /^make(?:\s|$)/.test(command) || script(command, "build"),
		init: (command, now) => newBar(command, now, "BUILD"),
		update: (state, text) => state.kind === "bar" && buildUpdate(state, text),
	},
];

/** First monitor that recognises one of the command's simple commands (multi-line scripts are left alone). */
export function detectMonitor(command: string): Monitor | undefined {
	if (command.includes("\n")) return undefined;
	for (const simple of simpleCommands(command)) {
		const found = MONITORS.find((monitor) => monitor.matches(simple));
		if (found) return found;
	}
	return undefined;
}
