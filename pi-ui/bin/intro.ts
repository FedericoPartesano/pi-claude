#!/usr/bin/env node
/**
 * Plays the pi-full intro (src/intro.ts) before Pi starts: alternate screen, hidden cursor, any key skips it.
 * Usage: node pi-ui/bin/intro.ts "<subtitle>"   ·   PI_UI_INTRO=0 turns it off.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { INTRO_MS, introFrame } from "../src/intro.ts";

const out = process.stdout;
if (!out.isTTY || !process.stdin.isTTY || process.env.PI_UI_INTRO === "0" || (out.columns ?? 0) < 40 || (out.rows ?? 0) < 12) process.exit(0);

/** The gradient of the theme chosen in Pi's settings. */
function palette(): [string, string] {
	try {
		const settings = JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent"), "settings.json"), "utf8"));
		if (String(settings.theme ?? "").includes("lilla")) return ["#AE95C7", "#95C7AE"];
		if (settings.theme === "night-city") return ["#FCEE0A", "#00F0FF"];
	} catch {
		// No settings yet: Neon Night.
	}
	return ["#ff3fd8", "#2ee6ff"];
}

const options = { width: out.columns, height: out.rows, subtitle: process.argv[2] || "pi-full", palette: palette(), seed: Date.now() % 1000 };
const started = Date.now();
let finished = false;

function finish(): void {
	if (finished) return;
	finished = true;
	clearInterval(timer);
	process.stdin.setRawMode(false);
	process.stdin.pause();
	out.write("\x1b[?25h\x1b[?1049l");
	process.exit(0);
}

out.write("\x1b[?1049h\x1b[?25l\x1b[2J");
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.once("data", finish);
const timer = setInterval(() => {
	const at = Date.now() - started;
	out.write(`\x1b[H${introFrame(Math.min(at, INTRO_MS), options).map((line) => `${line}\x1b[K`).join("\r\n")}`);
	// A short pause on the finished logo, then Pi takes over.
	if (at > INTRO_MS + 350) finish();
}, 33);
