import { test } from "node:test";
import assert from "node:assert/strict";
import { behindConPty, imageProtocolFor, regularMode, regularWidth } from "../src/terminal.ts";

test("WezTerm reached through Windows ConPTY (WSL or native Windows) gets iTerm2 images: kitty is filtered there", () => {
	assert.equal(behindConPty({ WSL_DISTRO_NAME: "Ubuntu", WEZTERM_PANE: "3" }, "linux"), true);
	assert.equal(behindConPty({ TERM_PROGRAM: "WezTerm" }, "win32"), true);
	assert.equal(behindConPty({ WEZTERM_PANE: "3" }, "linux"), false, "WezTerm on Linux/macOS talks to the shell directly");
	assert.equal(behindConPty({ WSL_DISTRO_NAME: "Ubuntu", WEZTERM_PANE: "3", TMUX: "/tmp/tmux" }, "linux"), false, "tmux in between: no images at all");
	assert.equal(behindConPty({ WSL_DISTRO_NAME: "Ubuntu", WT_SESSION: "x" }, "linux"), false, "Windows Terminal: no iTerm2 protocol");
	assert.equal(imageProtocolFor({ WSL_DISTRO_NAME: "Ubuntu", WEZTERM_PANE: "3" }, "linux", true), "iterm2", "regular mode draws iTerm2");
	assert.equal(imageProtocolFor({ WEZTERM_PANE: "3" }, "linux", false), undefined, "elsewhere pi-tui decides");
	assert.equal(imageProtocolFor({ WSL_DISTRO_NAME: "Ubuntu", WEZTERM_PANE: "3", PI_UI_IMAGES: "kitty" }, "linux", false), "kitty", "the user's choice wins");
});

test("fullscreen behind ConPTY: no inline images (kitty is filtered, iTerm2 is not drawn there), /img opens them", () => {
	assert.equal(imageProtocolFor({ WSL_DISTRO_NAME: "Ubuntu", WEZTERM_PANE: "3" }, "linux", false), null);
	assert.equal(imageProtocolFor({ WSL_DISTRO_NAME: "Ubuntu", WEZTERM_PANE: "3", PI_UI_IMAGES: "iterm2" }, "linux", false), "iterm2");
});

test("regularMode: --tui-mode regular on the command line, or tuiMode in the settings", () => {
	assert.equal(regularMode(["node", "cli.js", "--tui-mode", "regular"]), true);
	assert.equal(regularMode(["node", "cli.js", "--tui-mode=regular"]), true);
	assert.equal(regularMode(["node", "cli.js", "--tui-mode", "fullscreen"], "regular"), false, "the command line wins");
	assert.equal(regularMode(["node", "cli.js"], "regular"), true);
	assert.equal(regularMode(["node", "cli.js"]), false, "fullscreen is Pi's default");
});

test("regularWidth: one column short behind ConPTY, unchanged elsewhere", () => {
	assert.equal(regularWidth(160, 0, false), 160);
	assert.equal(regularWidth(160, 0, true), 159);
	assert.equal(regularWidth(160, 40, false), 119);
	assert.equal(regularWidth(160, 40, true), 118);
	assert.equal(regularWidth(30, 40, true), 20);
});
