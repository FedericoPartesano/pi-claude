/**
 * Icons of pi-ui. Nerd Font glyphs (codicons) where the terminal has them — WezTerm ships the Nerd Font symbols as a
 * fallback, so they show with any font — and plain Unicode elsewhere. PI_UI_ICONS=nerd|plain forces one set.
 */
const NERD = {
	read: "",
	edit: "",
	write: "",
	bash: "",
	search: "",
	folder: "",
	web: "",
	agent: "",
	todo: "",
	test: "",
	tool: "",
	branch: "",
	commit: "",
	memory: "",
	session: "",
	turn: "",
	activity: "",
	files: "",
	suggest: "",
	image: "",
	usage: "",
	think: "",
} as const;

export type IconName = keyof typeof NERD;

const PLAIN: Record<IconName, string> = {
	read: "",
	edit: "",
	write: "",
	bash: "",
	search: "",
	folder: "",
	web: "",
	agent: "",
	todo: "",
	test: "",
	tool: "",
	branch: "⎇",
	commit: "",
	memory: "◇",
	session: "",
	turn: "",
	activity: "",
	files: "",
	suggest: "",
	image: "",
	usage: "",
	think: "",
};

export type IconSet = "nerd" | "plain";

/** Nerd icons on WezTerm (also inside tmux, which keeps WEZTERM_PANE), plain elsewhere; PI_UI_ICONS overrides. */
export function iconSetFor(env: NodeJS.ProcessEnv): IconSet {
	if (env.PI_UI_ICONS === "nerd" || env.PI_UI_ICONS === "plain") return env.PI_UI_ICONS;
	return env.WEZTERM_PANE || env.TERM_PROGRAM === "WezTerm" ? "nerd" : "plain";
}

/** Current icons; the plain set is empty for most names, so callers write `withIcon(...)` and get no gap. */
export const I: Record<IconName, string> = { ...(iconSetFor(process.env) === "nerd" ? NERD : PLAIN) };

export function useIcons(set: IconSet): void {
	Object.assign(I, set === "nerd" ? NERD : PLAIN);
}

/** `icon text`, or just `text` when the icon set has no icon for it. */
export const withIcon = (icon: string, text: string) => (icon ? `${icon} ${text}` : text);

const TOOL_ICONS: Record<string, IconName> = { read: "read", edit: "edit", write: "write", bash: "bash", grep: "search", find: "search", ls: "folder", web_search: "web", fetch_content: "web", get_search_content: "web", source_check: "web", subagent: "agent", team: "agent", todo: "todo" };

export const toolIcon = (tool: string) => I[TOOL_ICONS[tool] ?? "tool"];

/** Short verbs of the HUD style. */
const VERBS: Record<string, string> = { read: "SCAN", ls: "SCAN", edit: "PATCH", write: "WRITE", bash: "EXEC", grep: "FIND", find: "FIND", web_search: "NET", fetch_content: "NET", get_search_content: "NET", source_check: "NET", subagent: "SPAWN", team: "SPAWN", todo: "PLAN" };
export const verbFor = (tool: string) => VERBS[tool] ?? tool.slice(0, 5).toUpperCase();
