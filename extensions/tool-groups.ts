/**
 * Tool Groups (lazy tools for pi-full)
 *
 * The pi-full extensions add ~6k tokens of tool definitions and prompt to every request, used or not.
 * This keeps their tools registered but inactive, and exposes one small `load_tools` tool the model
 * calls when a task needs a group. Pi rebuilds the system prompt on every change and sends the new
 * tool set on the next model request.
 *
 * Load this extension last, after the extensions whose tools it manages.
 * PI_FULL_TOOLS=web,team preloads groups; PI_FULL_TOOLS=all disables lazy loading.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const GROUPS = {
	web: { tools: ["web_search", "source_check", "fetch_content", "get_search_content"], summary: "web search, fetch URLs/pages, check sources" },
	todo: { tools: ["todo"], summary: "task list to track a job with many steps" },
	subagent: { tools: ["subagent"], summary: "delegate a self-contained subtask to one sub-agent with its own context" },
	team: { tools: ["team"], summary: "run a large multi-part job with a team of sub-agents and verified checks" },
} as const;

export type GroupName = keyof typeof GROUPS;
const GROUP_NAMES = Object.keys(GROUPS) as GroupName[];
const MANAGED_TOOLS = new Set<string>(GROUP_NAMES.flatMap((group) => GROUPS[group].tools));

/** The tools to keep active: everything not managed by a group, plus the tools of the loaded groups. */
export function activeToolsFor(allToolNames: string[], loaded: Set<GroupName>): string[] {
	const allowed = new Set([...loaded].flatMap((group) => GROUPS[group].tools as readonly string[]));
	return allToolNames.filter((name) => !MANAGED_TOOLS.has(name) || allowed.has(name));
}

/**
 * Next active tool set: unmanaged tools keep their current state (other extensions may have turned some on, e.g.
 * goal_done), managed tools come from the startup baseline filtered by the loaded groups.
 */
export function mergeActiveTools(current: string[], managedBaseline: string[], loaded: Set<GroupName>): string[] {
	return [...current.filter((name) => !MANAGED_TOOLS.has(name)), ...activeToolsFor(managedBaseline, loaded)];
}

/** Parses "web, team" / "web team" / "all" into known group names. */
export function parseGroups(text: string | undefined): { groups: GroupName[]; unknown: string[] } {
	const words = (text ?? "").split(/[\s,]+/).filter(Boolean);
	if (words.includes("all")) return { groups: [...GROUP_NAMES], unknown: [] };
	const isGroup = (word: string): word is GroupName => word in GROUPS;
	return { groups: words.filter(isGroup), unknown: words.filter((word) => !isGroup(word)) };
}

export default function (pi: ExtensionAPI) {
	const loaded = new Set<GroupName>(parseGroups(process.env.PI_FULL_TOOLS).groups);
	if (loaded.size === GROUP_NAMES.length) return; // everything preloaded: nothing to manage
	// Managed tools active before the first apply (respects --tools / --exclude-tools); groups filter this set.
	let baseline: string[] | undefined;
	const apply = () => {
		baseline ??= pi.getActiveTools().filter((name) => MANAGED_TOOLS.has(name));
		pi.setActiveTools(mergeActiveTools(pi.getActiveTools(), baseline, loaded));
	};
	const load = (groups: GroupName[]) => {
		const added = groups.filter((group) => !loaded.has(group));
		for (const group of added) loaded.add(group);
		if (added.length > 0) apply();
		return added;
	};

	// session_start covers the TUI pre-warm; before_agent_start covers print/json runs.
	const applyOnce = () => {
		if (baseline === undefined) apply();
	};
	pi.on("session_start", applyOnce);
	pi.on("before_agent_start", applyOnce);
	// Other extensions turn groups on directly (e.g. the work advisor choosing the team).
	pi.events.on("tool-groups:load", (data) => {
		load(parseGroups(Array.isArray(data) ? data.join(" ") : String(data)).groups);
	});

	pi.registerTool({
		name: "load_tools",
		label: "Load tools",
		description: [
			"Enable optional tool groups. They are off to keep requests small; load one only when the task needs it,",
			"then call its tools. Groups:",
			...GROUP_NAMES.map((group) => `- ${group}: ${GROUPS[group].summary}`),
		].join("\n"),
		parameters: {
			type: "object",
			properties: { groups: { type: "array", items: { type: "string", enum: GROUP_NAMES } } },
			required: ["groups"],
		} as never,

		async execute(_toolCallId, params) {
			const { groups, unknown } = parseGroups(((params as { groups?: string[] }).groups ?? []).join(" "));
			const added = load(groups);
			const names = groups.flatMap((group) => GROUPS[group].tools as readonly string[]).filter((name) => pi.getActiveTools().includes(name));
			const lines = [names.length > 0 ? `Available now: ${names.join(", ")}.` : "No tools enabled."];
			if (added.length === 0 && groups.length > 0) lines.push("Already loaded.");
			if (unknown.length > 0) lines.push(`Unknown groups: ${unknown.join(", ")}. Known: ${GROUP_NAMES.join(", ")}.`);
			return { content: [{ type: "text", text: lines.join(" ") }], details: undefined };
		},
	});

	pi.registerCommand("tools", {
		description: `Attiva gruppi di tool di pi-full: /tools web team · /tools all · /tools (stato). Gruppi: ${GROUP_NAMES.join(", ")}`,
		handler: async (args, ctx) => {
			const { groups, unknown } = parseGroups(args);
			if (unknown.length > 0) return ctx.ui.notify(`Gruppi sconosciuti: ${unknown.join(", ")}. Disponibili: ${GROUP_NAMES.join(", ")}`, "warning");
			load(groups);
			const status = GROUP_NAMES.map((group) => `${group} ${loaded.has(group) ? "✓" : "·"}`).join("  ");
			ctx.ui.notify(`Gruppi di tool: ${status}`, "info");
		},
	});
}
