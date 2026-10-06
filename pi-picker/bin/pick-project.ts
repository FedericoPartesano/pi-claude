#!/usr/bin/env node
/**
 * Standalone project picker (used by `pi-full --pick`): recent Pi projects, or browse the filesystem from home.
 * The TUI owns stdout, so the chosen folder is written to the file given with --out. Exit 0 = chosen, 1 = cancelled.
 *
 * Usage: node pick-project.ts --out <file>
 */
import { writeFileSync } from "node:fs";
import { matchesKey, ProcessTerminal, TuiAltScreen } from "@earendil-works/pi-tui";
import { PickerComponent, type PickerTheme } from "../src/component.ts";
import { projectsSource } from "../src/sources.ts";

const outIndex = process.argv.indexOf("--out");
const outFile = outIndex === -1 ? undefined : process.argv[outIndex + 1];
if (!outFile) {
	console.error("Uso: pick-project.ts --out <file>");
	process.exit(2);
}

const ansi = (code: number) => (text: string) => `\x1b[${code}m${text}\x1b[0m`;
const colors: Record<string, (text: string) => string> = { accent: ansi(36), borderAccent: ansi(36), border: ansi(90), muted: ansi(37), dim: ansi(90), success: ansi(32), warning: ansi(33) };
const theme: PickerTheme = { fg: (color, text) => (colors[color] ?? ((value: string) => value))(text), bold: ansi(1) };

const terminal = new ProcessTerminal();
const tui = new TuiAltScreen(terminal, false, undefined, { mouse: true });

const finish = (path: string | undefined) => {
	tui.stop();
	if (path) writeFileSync(outFile, path);
	process.exit(path ? 0 : 1);
};

// Box chrome takes 7 rows; keep one spare row.
const rows = Math.max((process.stdout.rows ?? 24) - 8, 5);
const picker = new PickerComponent({ title: "Scegli il progetto per Pi", source: projectsSource(), maxVisible: rows }, theme, (result) => finish(result?.[0]), () => tui.requestRender());

tui.addChild(picker);
tui.setFocus(picker);
tui.addInputListener((data) => {
	if (matchesKey(data, "ctrl+c")) finish(undefined);
	return undefined;
});
tui.start();
void picker.load();
