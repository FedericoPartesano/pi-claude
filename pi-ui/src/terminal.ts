/**
 * Which image protocol reaches the screen. WezTerm on Windows (native, or WSL through its WSL domain) sits behind
 * ConPTY, which drops kitty's APC sequences and passes iTerm2's OSC 1337 (measured): there images must be iTerm2, and
 * Pi must run in regular mode (its fullscreen mode draws kitty images only). tmux in between: no images.
 */
type Env = Record<string, string | undefined>;

const isWezTerm = (env: Env) => Boolean(env.WEZTERM_PANE) || env.TERM_PROGRAM === "WezTerm";

export function behindConPty(env: Env, platform: string): boolean {
	if (env.TMUX || !isWezTerm(env)) return false;
	return platform === "win32" || Boolean(env.WSL_DISTRO_NAME);
}

/** The protocol to force, or undefined to let pi-tui decide. PI_UI_IMAGES=kitty|iterm2 always wins. */
export function imageProtocolFor(env: Env, platform: string): "kitty" | "iterm2" | undefined {
	if (env.PI_UI_IMAGES === "kitty" || env.PI_UI_IMAGES === "iterm2") return env.PI_UI_IMAGES;
	return behindConPty(env, platform) ? "iterm2" : undefined;
}
