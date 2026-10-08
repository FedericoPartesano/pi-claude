/**
 * Which image protocol reaches the screen. WezTerm on Windows (native, or WSL through its WSL domain) sits behind
 * ConPTY, which drops kitty's APC sequences and passes iTerm2's OSC 1337 (measured): there images must be iTerm2, which
 * only Pi's regular mode draws. Regular mode drifts a row behind ConPTY (doubled status bar), so fullscreen stays the
 * default there and images open with /img. tmux in between: no images.
 */
type Env = Record<string, string | undefined>;

const isWezTerm = (env: Env) => Boolean(env.WEZTERM_PANE) || env.TERM_PROGRAM === "WezTerm";

export function behindConPty(env: Env, platform: string): boolean {
	if (env.TMUX || !isWezTerm(env)) return false;
	return platform === "win32" || Boolean(env.WSL_DISTRO_NAME);
}

/**
 * The protocol to force, null for none, or undefined to let pi-tui decide. PI_UI_IMAGES=kitty|iterm2 always wins.
 * Behind ConPTY only Pi's regular mode can show images (iTerm2); fullscreen draws kitty only, which ConPTY filters,
 * so there are none inline (the entry says /img opens them at full quality).
 */
export function imageProtocolFor(env: Env, platform: string, regular: boolean): "kitty" | "iterm2" | null | undefined {
	if (env.PI_UI_IMAGES === "kitty" || env.PI_UI_IMAGES === "iterm2") return env.PI_UI_IMAGES;
	if (!behindConPty(env, platform)) return undefined;
	return regular ? "iterm2" : null;
}

/** Whether Pi runs in regular mode: --tui-mode on the command line wins over tuiMode in the settings; fullscreen by default. */
export function regularMode(argv: string[], settingsMode?: string): boolean {
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--tui-mode") return argv[i + 1] === "regular";
		if (argv[i].startsWith("--tui-mode=")) return argv[i].slice("--tui-mode=".length) === "regular";
	}
	return settingsMode === "regular";
}

/**
 * Width the regular renderer lays the chat out at. Behind ConPTY a line that fills the last column leaves the terminal
 * in a pending-wrap state it handles differently from pi-tui's model, so the cursor drifts one row and redraws leave
 * stale copies (a doubled status bar, doubled blocks): there every line stops one column short.
 */
export function regularWidth(width: number, panelColumns: number, conpty: boolean): number {
	const room = conpty ? width - 1 : width;
	return panelColumns > 0 ? Math.max(20, room - panelColumns - 1) : room;
}
