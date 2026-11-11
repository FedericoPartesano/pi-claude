/**
 * Which skills an auto mode step gets, decided in code from skills/phases.json (no prompt spent on choosing):
 * fixed skills per step kind, a debugging skill when a build retries after a failed check, and keyword triggers on
 * the step context (goal, requirement, changed files). Full text only up to `maxInline` skills (each costs 3–6k
 * prompt tokens); the others go as path + "when to use", the triggered ones marked as recommended.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export type StepKind = "define" | "docs" | "plan" | "build" | "retry" | "review" | "ship";

export interface ListedSkill {
	path: string;
	when: string;
	recommended: boolean;
}

export interface SkillSet {
	inline: string[];
	list: ListedSkill[];
}

interface Trigger {
	skill: string;
	steps: StepKind[];
	match: string;
}

interface Contract {
	maxInline: number;
	steps: Partial<Record<StepKind, { inline: string[]; list: string[] }>>;
	triggers: { skill: string; steps: StepKind[]; regex: RegExp }[];
}

const contracts = new Map<string, Contract>();

function contract(skillsDir: string): Contract {
	const cached = contracts.get(skillsDir);
	if (cached) return cached;
	let raw: Record<string, any> = {};
	try {
		raw = JSON.parse(readFileSync(join(skillsDir, "phases.json"), "utf8"));
	} catch {}
	const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
	const steps: Contract["steps"] = {};
	for (const kind of ["define", "docs", "plan", "build", "retry", "review", "ship"] as StepKind[])
		if (raw[kind] && typeof raw[kind] === "object") steps[kind] = { inline: strings(raw[kind].inline), list: strings(raw[kind].list) };
	const triggers: Contract["triggers"] = [];
	for (const item of (Array.isArray(raw.triggers) ? raw.triggers : []) as Trigger[]) {
		try {
			if (typeof item.skill === "string" && typeof item.match === "string") triggers.push({ skill: item.skill, steps: strings(item.steps) as StepKind[], regex: new RegExp(item.match, "i") });
		} catch {}
	}
	const value = { maxInline: Number.isInteger(raw.maxInline) ? raw.maxInline : 2, steps, triggers };
	contracts.set(skillsDir, value);
	return value;
}

const whens = new Map<string, string>();

/** "When to use" of a skill: the `Use when …` sentence of its description, else the description's start. */
export function skillWhen(file: string): string {
	const cached = whens.get(file);
	if (cached !== undefined) return cached;
	let when = "";
	try {
		const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, "utf8"))?.[1] ?? "";
		const description = /^description:\s*(.+)$/m.exec(front)?.[1].replace(/^["']|["']$/g, "").trim() ?? "";
		when = (/\bUse when\b[^.]*\./.exec(description)?.[0] ?? description).slice(0, 180);
	} catch {}
	whens.set(file, when);
	return when;
}

/** Skill name from its folder path (`agent-skills/skills/x` or `/abs/…/x/SKILL.md` → `x`). */
export const skillName = (path: string) => basename(path.endsWith("SKILL.md") ? dirname(path) : path);

/** `kinds` in priority order (e.g. ["retry", "build"]); `context` is the text the triggers are matched on. */
export function selectSkills(skillsDir: string, kinds: StepKind[], context: string): SkillSet {
	const { maxInline, steps, triggers } = contract(skillsDir);
	const fixed = kinds.flatMap((kind) => steps[kind]?.inline ?? []);
	const triggered = triggers.filter((item) => item.steps.some((kind) => kinds.includes(kind)) && item.regex.test(context)).map((item) => item.skill);
	const inline: string[] = [];
	for (const path of [...fixed, ...triggered]) if (!inline.includes(path) && inline.length < maxInline) inline.push(path);
	const list: ListedSkill[] = [];
	const add = (path: string, recommended: boolean) => {
		if (inline.includes(path)) return;
		const existing = list.find((item) => item.path === path);
		if (existing) existing.recommended ||= recommended;
		else list.push({ path, when: skillWhen(join(skillsDir, path, "SKILL.md")), recommended });
	};
	for (const path of [...fixed, ...triggered]) add(path, true);
	for (const kind of kinds) for (const path of steps[kind]?.list ?? []) add(path, false);
	list.sort((a, b) => Number(b.recommended) - Number(a.recommended));
	return { inline, list };
}

/** System prompt text of a selection: inline skills without frontmatter, then the listed ones with their path. */
export function skillText(skillsDir: string, set: SkillSet): string {
	const parts: string[] = [];
	for (const path of set.inline) {
		try {
			const body = readFileSync(join(skillsDir, path, "SKILL.md"), "utf8").replace(/^---[\s\S]*?\n---\n/, "").trim();
			parts.push(`# Skill del passo: ${skillName(path)}\n\n${body}`);
		} catch {}
	}
	if (set.list.length)
		parts.push(
			[
				"Altre skill, da leggere con read prima di lavorare quando il caso descritto si presenta (quelle segnate «consigliata» riguardano questo passo):",
				...set.list.map((item) => `- ${join(skillsDir, item.path, "SKILL.md")}${item.recommended ? " (consigliata)" : ""}${item.when ? ` — ${item.when}` : ""}`),
			].join("\n"),
		);
	return parts.join("\n\n");
}
