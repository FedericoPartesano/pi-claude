/**
 * Charts drawn in the terminal. The model writes a ```grafico block with the data as JSON; pi-ui cuts it out of the
 * answer and draws it under the turn: horizontal bars (eighth blocks), vertical bars, or lines in braille dots.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { C, bold, fg, fit, pad } from "./palette.ts";

export interface ChartSpec {
	type: "bar" | "hbar" | "line";
	title?: string;
	labels: string[];
	series: { name?: string; values: number[] }[];
	unit?: string;
}

export const CHART_PROMPT = [
	"## Grafici",
	"Quando dei numeri si capiscono meglio in un grafico (andamenti, confronti, distribuzioni), aggiungi alla risposta un blocco",
	"```grafico con un JSON, e Pi lo disegna nel terminale:",
	'{"tipo": "barre" | "barre-orizzontali" | "linee", "titolo": "…", "etichette": ["…"], "serie": [{"nome": "…", "valori": [1, 2]}], "unita": "…"}',
	"Al massimo 40 valori per serie; usa i dati veri, senza inventarli.",
].join("\n");

const TYPES: Record<string, ChartSpec["type"]> = { barre: "bar", bar: "bar", colonne: "bar", "barre-orizzontali": "hbar", hbar: "hbar", orizzontali: "hbar", linee: "line", linea: "line", line: "line" };
const MAX_POINTS = 60;
/** Series colors of the current palette (read at render time: the palette follows the theme). */
const seriesColor = (index: number) => [C.cyan, C.mag, C.yel, C.ok][index % 4];

/** JSON of a ```grafico block → spec (Italian or English keys), or the reason it cannot be drawn. */
function normalize(raw: Record<string, unknown>): ChartSpec | string {
	const series = ((raw.serie ?? raw.series ?? []) as Record<string, unknown>[])
		.map((entry) => {
			const values = ((entry?.valori ?? entry?.values ?? []) as unknown[]).map(Number).filter(Number.isFinite).slice(0, MAX_POINTS);
			const name = (entry?.nome ?? entry?.name) as string | undefined;
			return name === undefined ? { values } : { name: String(name), values };
		})
		.filter((entry) => entry.values.length > 0);
	if (series.length === 0) return "grafico senza dati";
	const spec: ChartSpec = { type: TYPES[String(raw.tipo ?? raw.type ?? "barre").toLowerCase()] ?? "bar", labels: [], series };
	const title = raw.titolo ?? raw.title;
	if (title !== undefined) spec.title = String(title);
	spec.labels = ((raw.etichette ?? raw.labels ?? []) as unknown[]).map(String).slice(0, MAX_POINTS);
	const unit = raw.unita ?? raw["unità"] ?? raw.unit;
	if (unit !== undefined) spec.unit = String(unit);
	// Keep the key order of the spec stable: type, title, labels, series, unit.
	const { type, labels } = spec;
	return { type, ...(spec.title !== undefined ? { title: spec.title } : {}), labels, series, ...(spec.unit !== undefined ? { unit: spec.unit } : {}) };
}

const BLOCK = /```(?:grafico|chart)[^\n]*\n([\s\S]*?)```/g;

/** Charts in an answer; the blocks are replaced by a short pointer to the chart drawn under the turn. */
export function extractCharts(markdown: string): { text: string; charts: ChartSpec[]; errors: string[] } {
	const charts: ChartSpec[] = [];
	const errors: string[] = [];
	const text = markdown.replace(BLOCK, (_block, json: string) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(json);
		} catch {
			errors.push("JSON non valido");
			return "▦ *grafico non disegnabile: JSON non valido*";
		}
		const spec = normalize((parsed ?? {}) as Record<string, unknown>);
		if (typeof spec === "string") {
			errors.push(spec);
			return `▦ *${spec}*`;
		}
		charts.push(spec);
		return spec.title ? `▦ *grafico: ${spec.title}* ↓` : "▦ *grafico* ↓";
	});
	return { text, charts, errors };
}

const number = (value: number) => value.toLocaleString("it-IT", { maximumFractionDigits: 2 });
const withUnit = (value: number, unit?: string) => `${number(value)}${unit ? ` ${unit}` : ""}`;
const EIGHTHS_H = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
const EIGHTHS_V = ["", "▁", "▂", "▃", "▄", "▅", "▆", "▇"];

function header(spec: ChartSpec, width: number): string {
	const legend = spec.series.length > 1 ? spec.series.map((entry, index) => `${fg(seriesColor(index), "■")} ${fg(C.dim, entry.name ?? `serie ${index + 1}`)}`).join("  ") : "";
	return fit(`  ${fg(C.cyan, "▦")} ${bold(fg(C.text, spec.title ?? "grafico"))}${spec.unit ? fg(C.dim, ` (${spec.unit})`) : ""}`, legend ? `${legend} ` : "", width);
}

function horizontalBars(spec: ChartSpec, width: number): string[] {
	const count = Math.max(...spec.series.map((entry) => entry.values.length));
	const max = Math.max(...spec.series.flatMap((entry) => entry.values), 0) || 1;
	const labelWidth = Math.min(14, Math.max(1, ...Array.from({ length: count }, (_, index) => visibleWidth(spec.labels[index] ?? ""))));
	const valueWidth = Math.max(...spec.series.flatMap((entry) => entry.values.map((value) => withUnit(value, spec.unit).length)));
	const barWidth = Math.max(4, width - 2 - labelWidth - 1 - valueWidth - 2);
	const rows: string[] = [];
	for (let index = 0; index < count; index++) {
		spec.series.forEach((entry, seriesIndex) => {
			const value = entry.values[index];
			if (value === undefined) return;
			const eighths = Math.round((Math.max(0, value) / max) * barWidth * 8);
			const bar = "█".repeat(Math.floor(eighths / 8)) + EIGHTHS_H[eighths % 8];
			const color = spec.series.length > 1 ? seriesColor(seriesIndex) : value === max ? C.mag : C.cyan;
			const label = seriesIndex === 0 ? truncateToWidth(spec.labels[index] ?? "", labelWidth) : "";
			rows.push(pad(`  ${fg(C.dim, pad(label, labelWidth))} ${fg(color, bar)} ${fg(C.text, withUnit(value, spec.unit))}`, width));
		});
	}
	return rows;
}

function verticalBars(spec: ChartSpec, width: number): string[] {
	const height = 8;
	const count = Math.max(...spec.series.map((entry) => entry.values.length));
	const max = Math.max(...spec.series.flatMap((entry) => entry.values), 0) || 1;
	const groupWidth = Math.max(2, Math.floor((width - 2) / count));
	const barWidth = Math.max(1, Math.floor((groupWidth - 1) / spec.series.length));
	const rows: string[] = [];
	for (let row = height - 1; row >= 0; row--) {
		let line = "  ";
		for (let index = 0; index < count; index++) {
			let group = "";
			spec.series.forEach((entry, seriesIndex) => {
				const value = Math.max(0, entry.values[index] ?? 0);
				const level = Math.round((value / max) * height * 8) - row * 8;
				const cell = level >= 8 ? "█" : level <= 0 ? " " : EIGHTHS_V[level];
				const color = spec.series.length > 1 ? seriesColor(seriesIndex) : value === max ? C.mag : C.cyan;
				group += fg(color, cell.repeat(barWidth));
			});
			line += pad(group, groupWidth);
		}
		rows.push(pad(truncateToWidth(line, width), width));
	}
	const center = (text: string) => {
		const cut = truncateToWidth(text, groupWidth - 1, "");
		const left = Math.floor((groupWidth - visibleWidth(cut)) / 2);
		return pad(" ".repeat(left) + cut, groupWidth);
	};
	const values = spec.series[0].values;
	rows.push(pad(truncateToWidth(`  ${Array.from({ length: count }, (_, index) => fg(C.text, center(values[index] === undefined ? "" : number(values[index])))).join("")}`, width), width));
	rows.push(pad(truncateToWidth(`  ${Array.from({ length: count }, (_, index) => fg(C.dim, center(spec.labels[index] ?? ""))).join("")}`, width), width));
	return rows;
}

const BRAILLE_BITS = [
	[0x01, 0x08],
	[0x02, 0x10],
	[0x04, 0x20],
	[0x40, 0x80],
];

function lines(spec: ChartSpec, width: number): string[] {
	const height = 8;
	const all = spec.series.flatMap((entry) => entry.values);
	const min = Math.min(...all);
	const max = Math.max(...all);
	const axisWidth = Math.max(number(min).length, number(max).length);
	const plotWidth = Math.max(4, width - 2 - axisWidth - 2);
	const dotsX = plotWidth * 2;
	const dotsY = height * 4;
	const bits = Array.from({ length: height }, () => new Array<number>(plotWidth).fill(0));
	const colors = Array.from({ length: height }, () => new Array<string>(plotWidth).fill(C.cyan));
	const plot = (x: number, y: number, color: string) => {
		const row = Math.floor((dotsY - 1 - y) / 4);
		const col = Math.floor(x / 2);
		if (row < 0 || row >= height || col < 0 || col >= plotWidth) return;
		bits[row][col] |= BRAILLE_BITS[(dotsY - 1 - y) % 4][x % 2];
		colors[row][col] = color;
	};
	spec.series.forEach((entry, seriesIndex) => {
		const color = seriesColor(seriesIndex);
		const points = entry.values.map((value, index) => ({
			x: entry.values.length === 1 ? 0 : Math.round((index * (dotsX - 1)) / (entry.values.length - 1)),
			y: max === min ? Math.floor(dotsY / 2) : Math.round(((value - min) / (max - min)) * (dotsY - 1)),
		}));
		points.forEach((point, index) => {
			const next = points[index + 1] ?? point;
			const steps = Math.max(Math.abs(next.x - point.x), Math.abs(next.y - point.y), 1);
			for (let step = 0; step <= steps; step++) plot(Math.round(point.x + ((next.x - point.x) * step) / steps), Math.round(point.y + ((next.y - point.y) * step) / steps), color);
		});
	});
	const rows = bits.map((row, rowIndex) => {
		const axis = rowIndex === 0 ? number(max) : rowIndex === height - 1 ? number(min) : "";
		const cells = row.map((value, col) => (value ? fg(colors[rowIndex][col], String.fromCharCode(0x2800 + value)) : " ")).join("");
		return pad(`  ${fg(C.dim, axis.padStart(axisWidth))}${fg(C.faint, rowIndex === 0 || rowIndex === height - 1 ? "┤" : "│")}${cells}`, width);
	});
	const first = spec.labels[0] ?? "";
	const last = spec.labels[spec.labels.length - 1] ?? "";
	const axisRow = `  ${" ".repeat(axisWidth)} ${fg(C.dim, first)}`;
	rows.push(fit(truncateToWidth(axisRow, width), spec.labels.length > 1 ? `${fg(C.dim, truncateToWidth(last, 14))} ` : "", width));
	return rows;
}

export function renderChart(spec: ChartSpec, width: number): string[] {
	const body = spec.type === "hbar" ? horizontalBars(spec, width) : spec.type === "line" ? lines(spec, width) : verticalBars(spec, width);
	return [header(spec, width), ...body.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width) : line))];
}
