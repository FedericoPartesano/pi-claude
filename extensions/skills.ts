/**
 * Skills: activates agent-skills on its own. On each user turn the router (skills-router.ts) reads message, command,
 * repo changes and session history; the chosen skill goes in as a hidden message with its SKILL.md (no frontmatter),
 * only when something fires, so the fixed prompt stays untouched; the chat shows one compact line for it. A status chip names the active skill.
 * `/skills` shows state and history; `/skills off|on [nome]`, `/skills reset`. PI_SKILLS=0 turns it all off.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { skillName } from "./auto/skills.ts";
import { loadRouter, route, type Activation, type RepoContext } from "./skills-router.ts";

export const SKILLS_DIR = join(import.meta.dirname, "..", "skills");

export interface HistoryEntry {
	at: number;
	skill: string;
	reason: string;
	signals: string[];
	/** Rough size of the injected text (chars / 4). */
	tokens: number;
}

/** Changed files from `git status`; empty when not a repo or slow (never blocks the turn for long). */
export function repoContext(cwd: string): RepoContext {
	try {
		const out = execFileSync("git", ["status", "--porcelain"], { cwd, timeout: 400, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
		const files = out.split("\n").filter(Boolean).map((line) => line.slice(3).replace(/^.* -> /, ""));
		return { files, diffLarge: files.length > 15 };
	} catch {
		return {};
	}
}

/** Skill body without frontmatter, headed by its name. */
export function skillBody(skillsDir: string, skill: string): string {
	const raw = readFileSync(join(skillsDir, skill, "SKILL.md"), "utf8");
	return `# Skill attivata: ${skillName(skill)}\n\n${raw.replace(/^---[\s\S]*?\n---\n/, "").trim()}`;
}

/** The one line shown in the chat when a skill fires; expanded adds the signals that matched. */
export function skillLine(details: { skills?: { skill: string; reason: string; tokens?: number; signals?: string[] }[] } | undefined, expanded: boolean, width: number): string[] {
	const list = details?.skills ?? [];
	const cut = (text: string) => (text.length > width - 2 ? `${text.slice(0, Math.max(1, width - 3))}…` : text);
	const lines = list.map((hit) => cut(`↳ skill: ${hit.skill} — ${hit.reason}${hit.tokens ? ` (~${hit.tokens} token)` : ""}`));
	if (expanded) for (const hit of list) if (hit.signals?.length) lines.push(cut(`    segnali: ${hit.signals.join(", ")}`));
	return lines.length ? ["", ...lines.map((line) => ` ${line}`)] : [];
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_SKILLS === "0") return;
	const router = loadRouter(SKILLS_DIR);
	let active = new Set<string>();
	let disabled = new Set<string>();
	let history: HistoryEntry[] = [];
	// One compact line in the flow (the full SKILL.md stays in the model's context only); ctrl+o expands it.
	pi.registerMessageRenderer("skill-activation", (message, options, theme) => ({ render: (width: number) => skillLine(message.details as never, !!options.expanded, width).map((line) => theme.fg("dim", line)), invalidate() {} }));
	let current: Activation[] = [];
	// Tells pi-ui's panel what to show (history, off list); a small object, sent only when something changes.
	const publish = () => pi.events.emit("skills:state", { history: history.slice(-6), off: router.rules.filter((r) => disabled.has(r.skill)).map((r) => skillName(r.skill)), current: current.map((hit) => ({ skill: skillName(hit.skill), tier: hit.tier })) });

	pi.on("session_start", () => {
		active = new Set();
		history = [];
		current = [];
		publish();
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (event.messageType !== "user") return undefined;
		const all = route(router, { message: event.prompt, repo: repoContext(ctx.cwd), active, disabled });
		current = all;
		// Only high-confidence hits are injected; the rest is a free suggestion (chip + history), never prompt text.
		const picked = all.filter((hit) => hit.tier === "auto");
		const suggested = all.filter((hit) => hit.tier === "suggest");
		if (suggested.length && ctx.hasUI) ctx.ui.setStatus("skill", suggested.map((hit) => `? ${skillName(hit.skill)}`).join(" · "));
		for (const hit of suggested) history.push({ at: Date.now(), skill: skillName(hit.skill), reason: `${hit.reason} (solo suggerita)`, signals: hit.signals, tokens: 0 });
		if (!picked.length) return undefined;
		const parts: string[] = [];
		const shown: { skill: string; reason: string; tokens: number; signals: string[] }[] = [];
		for (const hit of picked) {
			try {
				const body = skillBody(SKILLS_DIR, hit.skill);
				parts.push(body);
				active.add(hit.skill);
				const tokens = Math.round(body.length / 4);
				history.push({ at: Date.now(), skill: skillName(hit.skill), reason: hit.reason, signals: hit.signals, tokens });
				shown.push({ skill: skillName(hit.skill), reason: hit.reason, tokens, signals: hit.signals });
			} catch {}
		}
		publish();
		if (!parts.length) return undefined;
		if (ctx.hasUI) ctx.ui.setStatus("skill", picked.map((hit) => skillName(hit.skill)).join(" · "));
		return { message: { customType: "skill-activation", content: parts.join("\n\n"), display: true, details: { skills: shown } } };
	});

	pi.on("agent_end", (_event, ctx) => {
		current = [];
		publish();
		if (ctx.hasUI) ctx.ui.setStatus("skill", undefined);
	});

	pi.registerCommand("skills", {
		description: "Skill automatiche: /skills · off|on [nome] · reset",
		handler: async (args, ctx) => {
			const [verb, name] = args.trim().split(/\s+/);
			const find = (n?: string) => router.rules.map((r) => r.skill).find((s) => skillName(s) === n);
			if (verb === "off" || verb === "on") {
				if (!name) {
					if (verb === "off") for (const rule of router.rules) disabled.add(rule.skill);
					else disabled.clear();
					publish();
				return ctx.ui.notify(`Skill automatiche: ${verb === "off" ? "tutte spente" : "tutte accese"}.`, "info");
				}
				const skill = find(name);
				if (!skill) return ctx.ui.notify(`Skill sconosciuta: ${name}.`, "warning");
				if (verb === "off") disabled.add(skill);
				else disabled.delete(skill);
				publish();
				return ctx.ui.notify(`${name}: ${verb === "off" ? "spenta" : "accesa"}.`, "info");
			}
			if (verb === "reset") {
				active.clear();
				return ctx.ui.notify("Le skill già attivate in sessione possono ripartire.", "info");
			}
			const lines = history.length ? history.slice(-8).map((h) => `${new Date(h.at).toTimeString().slice(0, 8)}  ${h.skill} — ${h.reason} (~${h.tokens} token)`) : ["Nessuna attivazione in questa sessione."];
			const off = router.rules.filter((r) => disabled.has(r.skill)).map((r) => skillName(r.skill));
			ctx.ui.notify([`Skill automatiche (${router.rules.length} regole${off.length ? `, spente: ${off.join(", ")}` : ""})`, ...lines].join("\n"), "info");
		},
	});
}
