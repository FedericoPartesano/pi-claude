import { test } from "node:test";
import assert from "node:assert/strict";
import { behindConPty, imageProtocolFor } from "../src/terminal.ts";

test("WezTerm reached through Windows ConPTY (WSL or native Windows) gets iTerm2 images: kitty is filtered there", () => {
	assert.equal(behindConPty({ WSL_DISTRO_NAME: "Ubuntu", WEZTERM_PANE: "3" }, "linux"), true);
	assert.equal(behindConPty({ TERM_PROGRAM: "WezTerm" }, "win32"), true);
	assert.equal(behindConPty({ WEZTERM_PANE: "3" }, "linux"), false, "WezTerm on Linux/macOS talks to the shell directly");
	assert.equal(behindConPty({ WSL_DISTRO_NAME: "Ubuntu", WEZTERM_PANE: "3", TMUX: "/tmp/tmux" }, "linux"), false, "tmux in between: no images at all");
	assert.equal(behindConPty({ WSL_DISTRO_NAME: "Ubuntu", WT_SESSION: "x" }, "linux"), false, "Windows Terminal: no iTerm2 protocol");
	assert.equal(imageProtocolFor({ WSL_DISTRO_NAME: "Ubuntu", WEZTERM_PANE: "3" }, "linux"), "iterm2");
	assert.equal(imageProtocolFor({ WEZTERM_PANE: "3" }, "linux"), undefined, "elsewhere pi-tui decides");
	assert.equal(imageProtocolFor({ WSL_DISTRO_NAME: "Ubuntu", WEZTERM_PANE: "3", PI_UI_IMAGES: "kitty" }, "linux"), "kitty", "the user's choice wins");
});
