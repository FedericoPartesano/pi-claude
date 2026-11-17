/**
 * Chat skill router: decides in code, with no model call and no prompt text, which skills a user turn should get.
 * Signals: message text, slash command, files changed in the repo, state flags; history stops re-activation.
 * Rules live in skills/router.json (same relative paths as phases.json). Pure module: no Pi imports, easy to test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Signal = "text" | "command" | "files" | "state";

export interface RepoContext {
	/** Files changed in the working tree (relative paths). */
	files?: string[];
	testsFailing?: boolean;
	diffLarge?: boolean;
}

export interface Activation {
	/** Skill path relative to the skills dir, e.g. `agent-skills/skills/code-review-and-quality`. */
	skill: string;
	score: number;
	signals: Signal[];
	/** Short human reason, e.g. `testo: «bug»`. */
	reason: string;
	/** `auto` injects the skill; `suggest` only proposes it (chip), at no token cost. */
	tier: "auto" | "suggest";
}

interface Weighted {
	regex: RegExp;
	w: number;
}

interface Rule {
	skill: string;
	text: Weighted[];
	files: Weighted[];
	command: Record<string, number>;
	state: Record<string, number>;
}

export interface Router {
	/** Request framing (imperative or «voglio…»): adds weight to keyword hits, so a bare keyword in a remark never fires. */
	frame?: Weighted;
	/** Messages that never route: hook feedback, pasted URLs, status reports in the past tense. */
	veto?: RegExp;
	maxLen: number;
	/** Score from which a skill is injected on its own; between `threshold` and this it is only suggested. */
	autoThreshold: number;
	threshold: number;
	maxPerTurn: number;
	rules: Rule[];
}

const routers = new Map<string, Router>();

const weighted = (value: unknown): Weighted[] => {
	const out: Weighted[] = [];
	for (const item of Array.isArray(value) ? value : []) {
		try {
			if (typeof item?.match === "string" && Number.isFinite(item.w)) out.push({ regex: new RegExp(item.match, "i"), w: item.w });
		} catch {}
	}
	return out;
};

const numbers = (value: unknown): Record<string, number> => {
	const out: Record<string, number> = {};
	if (value && typeof value === "object") for (const [key, w] of Object.entries(value)) if (Number.isFinite(w)) out[key] = w as number;
	return out;
};

/** Loads (and caches) skills/router.json from `skillsDir`; a missing or broken file gives a router that never fires. */
export function loadRouter(skillsDir: string): Router {
	const cached = routers.get(skillsDir);
	if (cached) return cached;
	let raw: Record<string, any> = {};
	try {
		raw = JSON.parse(readFileSync(join(skillsDir, "router.json"), "utf8"));
	} catch {}
	const rules: Rule[] = [];
	for (const item of Array.isArray(raw.rules) ? raw.rules : [])
		if (typeof item?.skill === "string") rules.push({ skill: item.skill, text: weighted(item.text), files: weighted(item.files), command: numbers(item.command), state: numbers(item.state) });
	let veto: RegExp | undefined;
	try {
		if (typeof raw.veto === "string") veto = new RegExp(raw.veto, "i");
	} catch {}
	const router: Router = {
		frame: weighted([raw.frame])[0],
		veto,
		maxLen: Number.isFinite(raw.maxLen) ? raw.maxLen : 600,
		threshold: Number.isFinite(raw.threshold) ? raw.threshold : 2,
		autoThreshold: Number.isFinite(raw.autoThreshold) ? raw.autoThreshold : 2,
		maxPerTurn: Number.isInteger(raw.maxPerTurn) ? raw.maxPerTurn : 2,
		rules,
	};
	routers.set(skillsDir, router);
	return router;
}

export interface RouteInput {
	message: string;
	repo?: RepoContext;
	/** Skills (paths) already activated in this session: never re-activated. */
	active?: ReadonlySet<string>;
	/** Skills the user switched off. */
	disabled?: ReadonlySet<string>;
}

/**
 * Skills to activate for this turn, best first. An explicit `/skill:name` disables routing for the message;
 * any other slash command is routed on the command name alone (its arguments are not prose).
 */
export function route(router: Router, input: RouteInput): Activation[] {
	const raw = input.message.trim();
	const message = raw.replace(/https?:\/\/\S+/g, " ");
	if (!raw || raw.startsWith("/skill:")) return [];
	const command = raw.startsWith("/") ? /^\/\S+/.exec(raw)![0].toLowerCase() : "";
	if (!command && (message.length > router.maxLen || router.veto?.test(message))) return [];
	const framed = !command && router.frame ? router.frame.regex.test(message) : false;
	const found: Activation[] = [];
	for (const rule of router.rules) {
		if (input.active?.has(rule.skill) || input.disabled?.has(rule.skill)) continue;
		let score = 0;
		const signals = new Set<Signal>();
		let reason = "";
		const hit = (signal: Signal, w: number, why: string) => {
			score += w;
			signals.add(signal);
			reason ||= why;
		};
		if (command) {
			if (rule.command[command]) hit("command", rule.command[command], `comando ${command}`);
		} else {
			for (const { regex, w } of rule.text) {
				const m = regex.exec(message);
				if (m) hit("text", w, `testo: «${m[0].toLowerCase()}»`);
			}
			if (score > 0 && framed) hit("text", router.frame!.w, "");
		}
		for (const { regex, w } of rule.files) {
			const file = input.repo?.files?.find((f) => regex.test(f));
			if (file) hit("files", w, `file: ${file}`);
		}
		for (const [flag, w] of Object.entries(rule.state)) if (input.repo?.[flag as keyof RepoContext] === true) hit("state", w, flag === "testsFailing" ? "test rossi" : flag);
		if (score >= router.threshold) found.push({ skill: rule.skill, score, signals: [...signals], reason, tier: score >= router.autoThreshold ? "auto" : "suggest" });
	}
	return found.sort((a, b) => b.score - a.score).slice(0, router.maxPerTurn);
}
