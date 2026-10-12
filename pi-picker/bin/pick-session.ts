/**
 * Standalone session picker (used by `pi-full --resume`): the sessions of this folder, most recent first.
 * The TUI owns stdout, so the choice is written to the file given with --out: line 1 = session file, line 2 = its folder.
 * Exit 0 = chosen, 1 = cancelled. Usage: node pick-session.ts --out <file>
 */
import { writeFileSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { matchesKey, ProcessTerminal, TuiAltScreen } from "@earendil-works/pi-tui";
import { PickerComponent, type PickerTheme } from "../src/component.ts";
import { sessionsSource } from "../src/sources.ts";

const outIndex = process.argv.indexOf("--out");
const outFile = outIndex === -1 ? undefined : process.argv[outIndex + 1];
if (!outFile) {
	console.error("Uso: pick-session.ts --out <file>");
	process.exit(2);
}

const all = await SessionManager.list(process.cwd());
const sessions = all.filter((session) => session.cwd === process.cwd() && session.messageCount > 0);
if (!sessions.length) {
	console.error("Nessuna sessione da riprendere in questa cartella.");
	process.exit(1);
}
const folders = new Map(sessions.map((session) => [session.path, session.cwd]));

const ansi = (code: number) => (text: string) => `\x1b[${code}m${text}\x1b[0m`;
const colors: Record<string, (text: string) => string> = { accent: ansi(36), borderAccent: ansi(36), border: ansi(90), muted: ansi(37), dim: ansi(90), success: ansi(32), warning: ansi(33) };
const theme: PickerTheme = { fg: (color, text) => (colors[color] ?? ((value: string) => value))(text), bold: ansi(1) };

const terminal = new ProcessTerminal();
const tui = new TuiAltScreen(terminal, false, undefined, { mouse: true });

const finish = (path: string | undefined) => {
	tui.stop();
	if (path) writeFileSync(outFile, `${path}\n${folders.get(path) ?? ""}\n`);
	process.exit(path ? 0 : 1);
};

const rows = Math.max((process.stdout.rows ?? 24) - 8, 5);
const picker = new PickerComponent({ title: "Riprendi una sessione", source: sessionsSource(sessions), maxVisible: rows }, theme, (result) => finish(result?.[0]), () => tui.requestRender());

tui.addChild(picker);
tui.setFocus(picker);
tui.addInputListener((data) => {
	if (matchesKey(data, "ctrl+c")) finish(undefined);
	return undefined;
});
tui.start();
void picker.load();
