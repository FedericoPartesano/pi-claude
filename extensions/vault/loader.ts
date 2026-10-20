/** Text of the vault loader shown above the editor while indexing: spinner, steps, bar, what is being read. Pure: the caller passes the clock. */
import { bar, compact, duration } from "../graph/progress.ts";

export type Step = "lettura" | "modello" | "vettori" | "salvataggio";
const STEPS: { id: Step; label: string }[] = [
	{ id: "lettura", label: "Lettura note" },
	{ id: "modello", label: "Modello" },
	{ id: "vettori", label: "Vettori" },
	{ id: "salvataggio", label: "Salvataggio" },
];
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const WIDTH = 34;

export interface LoaderState {
	step: Step;
	/** Sources found (CLAUDE.md and notes). */
	files: number;
	done: number;
	total: number;
	filesDone: number;
	filesTotal: number;
	/** What is being read right now: "path › section". */
	current: string;
	startedAt: number;
	now: number;
	/** Files already read, oldest first (the full-screen feed). */
	feed?: string[];
	/** Sections per second sampled over time (the sparkline). */
	rates?: number[];
}
const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const rgb = (r: number, g: number, b: number) => `${ESC}38;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m`;
const dim = (text: string) => `${ESC}38;2;110;116;140m${text}${RESET}`;
const bright = (text: string) => `${ESC}1;38;2;240;244;255m${text}${RESET}`;
/** Aurora palette: cyan -> violet -> pink, looping; `t` in [0, 1). */
const aurora = (t: number) => {
	const stops: [number, number, number][] = [[64, 220, 255], [140, 110, 255], [255, 90, 190], [64, 220, 255]];
	const x = (((t % 1) + 1) % 1) * 3;
	const i = Math.min(2, Math.floor(x));
	const f = x - i;
	const [a, b] = [stops[i], stops[i + 1]];
	return rgb(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
};
const paint = (text: string, shift: number, spread = 0.02) => `${[...text].map((char, index) => (char === " " ? char : `${aurora(shift + index * spread)}${char}`)).join("")}${RESET}`;

const GLYPHS: Record<string, string[]> = {
	V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
	A: [" ███ ", "█   █", "█████", "█   █", "█   █"],
	U: ["█   █", "█   █", "█   █", "█   █", " ███ "],
	L: ["█    ", "█    ", "█    ", "█    ", "█████"],
	T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
};
const TITLE = [0, 1, 2, 3, 4].map((row) => [..."VAULT"].map((letter) => GLYPHS[letter][row]).join("  "));
const SPARK = "▁▂▃▄▅▆▇█";
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const fit = (text: string, width: number) => (text.length > width ? `…${text.slice(text.length - width + 1)}` : text);

/**
 * Full-screen loader: big gradient title, animated aurora bar, step pills, live stats, throughput sparkline and the feed
 * of files being read. Exactly `height` lines, each exactly `width` columns of text (ANSI colours do not count). Pure.
 */
export function loaderScreen(state: LoaderState, width: number, height: number): string[] {
	const at = STEPS.findIndex((step) => step.id === state.step);
	const fraction = state.step === "vettori" ? (state.total ? state.done / state.total : 1) : state.step === "salvataggio" ? 1 : 0;
	const elapsed = state.now - state.startedAt;
	const shift = state.now / 4000;
	const inner = Math.max(24, Math.min(width - 6, 78));
	const tall = height >= 26;
	const spin = SPINNER[Math.floor(state.now / 90) % SPINNER.length];
	const body: string[] = [];
	const center = (styled: string) => {
		// Too wide for the terminal: plain text, cut to fit.
		const line = strip(styled).length > width ? `${strip(styled).slice(0, width - 1)}…` : styled;
		return `${" ".repeat(Math.max(0, Math.floor((width - strip(line).length) / 2)))}${line}`;
	};
	if (tall) {
		TITLE.forEach((row) => body.push(center(paint(row, shift, 0.025))));
		body.push("");
		body.push(center(dim("indice locale di CLAUDE.md e del vault · niente esce dal computer")));
	} else {
		body.push(center(paint("V  A  U  L  T", shift, 0.03)));
	}
	body.push("");
	const pills = STEPS.map((step, index) => {
		const text = `${index < at ? "✓" : index === at ? spin : "·"} ${step.label}`;
		return index < at ? `${rgb(90, 220, 150)}${text}${RESET}` : index === at ? bright(text) : dim(text);
	});
	body.push(center(pills.join(dim("   ›   "))));
	body.push("");
	const filled = Math.round(fraction * inner);
	const sweep = Math.floor(state.now / 25) % (inner * 2);
	const headAt = sweep > inner ? inner * 2 - sweep : sweep;
	const cells = [...Array(inner).keys()].map((index) => {
		if (index >= filled) return `${rgb(46, 50, 70)}░`;
		const glow = Math.abs(index - headAt) < 3 && fraction < 1;
		return `${glow ? rgb(255, 255, 255) : aurora(shift + (index / inner) * 0.6)}█`;
	});
	body.push(center(`${cells.join("")}${RESET}`));
	const detail = state.step === "vettori" ? `   ${compact(state.done)} di ${compact(state.total)} sezioni` : state.step === "lettura" ? `   ${state.files} file trovati` : "";
	body.push(center(bright(`${Math.round(fraction * 100)}%`) + dim(detail)));
	body.push("");
	const rate = state.step === "vettori" && elapsed > 0 ? state.done / (elapsed / 1000) : 0;
	const left = state.step === "vettori" && state.done > 0 && state.done < state.total ? duration((elapsed / state.done) * (state.total - state.done)) : "—";
	const stat = (label: string, value: string) => `${dim(label)} ${bright(value)}`;
	body.push(center([
		stat("file", state.filesTotal ? `${Math.min(state.filesDone + 1, state.filesTotal)}/${state.filesTotal}` : "—"),
		stat("velocità", rate ? `${rate.toFixed(1)}/s` : "—"),
		stat("trascorso", duration(elapsed)),
		stat("restano", left),
	].join(dim("   │   "))));
	const rates = (state.rates ?? []).slice(-inner);
	if (tall && rates.length > 1) {
		const peak = Math.max(...rates, 0.1);
		body.push("");
		body.push(center(`${rates.map((value, index) => `${aurora(shift + index / inner)}${SPARK[Math.min(7, Math.floor((value / peak) * 7.99))]}`).join("")}${RESET}`));
		body.push(center(dim("sezioni al secondo nel tempo")));
	}
	body.push("");
	const rows = Math.max(1, Math.min(tall ? 6 : 2, height - body.length - 4));
	const label = state.current || (state.step === "modello" ? "carico il modello di ricerca (la prima volta è lento)" : state.step === "salvataggio" ? "scrivo l'indice su disco" : "…");
	const lines = [...(state.feed ?? []).slice(-rows).map((item) => dim(`✓ ${fit(item, inner - 2)}`)), `${aurora(shift)}${spin}${RESET} ${bright(fit(label, inner - 2))}`];
	lines.slice(-rows).forEach((line) => body.push(center(line)));
	body.push("");
	body.push(center(dim("Esc annulla (nulla salvato)   ·   Invio o B continua in background")));
	const top = Math.max(0, Math.floor((height - body.length) / 2));
	const screen = [...Array(top).fill(""), ...body].slice(0, height);
	while (screen.length < height) screen.push("");
	return screen.map((line) => `${line}${" ".repeat(Math.max(0, width - strip(line).length))}`);
}


export function loaderLines(state: LoaderState): string[] {
	const at = STEPS.findIndex((step) => step.id === state.step);
	const steps = STEPS.map((step, index) => `${index < at ? "✓" : index === at ? "●" : "○"} ${step.label}`).join("   ");
	const fraction = state.step === "vettori" ? (state.total ? state.done / state.total : 1) : state.step === "salvataggio" ? 1 : 0;
	const elapsed = state.now - state.startedAt;
	const left = state.step === "vettori" && state.done > 0 && state.done < state.total ? `   restano ~${duration((elapsed / state.done) * (state.total - state.done))}` : "";
	const spinner = SPINNER[Math.floor(state.now / 90) % SPINNER.length];
	const detail = state.step === "vettori" ? `${compact(state.done)}/${compact(state.total)} sezioni` : state.step === "lettura" ? `${state.files} file trovati` : "";
	return [
		`${spinner} Analizzo CLAUDE.md e vault`,
		steps,
		`${bar(fraction, WIDTH)} ${String(Math.round(fraction * 100)).padStart(3)}%  ${detail}`,
		`Sto leggendo: ${state.current || (state.step === "modello" ? "carico il modello di ricerca (solo la prima volta è lento)" : state.step === "salvataggio" ? "scrivo l'indice su disco" : "…")}`,
		`${state.filesTotal ? `File ${Math.min(state.filesDone + 1, state.filesTotal)}/${state.filesTotal}   ` : ""}Tempo ${duration(elapsed)}${left}   Esc per annullare`,
	];
}
