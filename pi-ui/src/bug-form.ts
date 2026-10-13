/** The /bug modal: a few fields, a severity, two switches and a confirm row. Tab/↑↓ move, Ctrl+S confirms anywhere, Esc cancels. */
import { CURSOR_MARKER, decodeKittyPrintable, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable } from "@earendil-works/pi-tui";
import type { BugForm } from "../../extensions/bug/bundle.ts";

export interface FormTheme {
	fg(role: "accent" | "muted" | "dim" | "text" | "success" | "warning" | "error" | "border", text: string): string;
	bold(text: string): string;
}

const SEVERITIES: BugForm["severity"][] = ["blocca", "fastidio", "piccolo"];
const SEVERITY_TEXT: Record<BugForm["severity"], string> = { blocca: "mi blocca", fastidio: "fastidio", piccolo: "piccolo difetto" };

type Row = { id: "title" | "happened" | "expected"; label: string; hint: string } | { id: "severity" | "redact" | "send" | "confirm"; label: string; hint: string };

export class BugFormModal implements Component, Focusable {
	focused = false;
	private index = 0;
	private rows: Row[];
	private values: BugForm;
	private error = "";

	private readonly theme: FormTheme;
	private readonly where: string | undefined;
	private readonly done: (form: BugForm | undefined) => void;
	private readonly requestRender: () => void;
	private readonly height: () => number;

	constructor(theme: FormTheme, where: string | undefined, done: (form: BugForm | undefined) => void, requestRender: () => void, height: () => number, start: Partial<BugForm> = {}) {
		this.theme = theme;
		this.where = where;
		this.done = done;
		this.requestRender = requestRender;
		this.height = height;
		this.values = { title: "", happened: "", expected: "", severity: "fastidio", redact: true, send: Boolean(where), ...start };
		this.rows = [
			{ id: "title", label: "Titolo", hint: "una riga che riassume il problema" },
			{ id: "happened", label: "Cosa è successo", hint: "e cosa stavi facendo; più dettagli, meglio" },
			{ id: "expected", label: "Cosa ti aspettavi", hint: "il comportamento giusto" },
			{ id: "severity", label: "Gravità", hint: "← → per cambiare" },
			{ id: "redact", label: "Oscura chiavi e password nell'invio", hint: "spazio per cambiare · la copia sul tuo disco resta intera" },
			...(where ? [{ id: "send" as const, label: `Invia anche al server`, hint: `spazio per cambiare · ${where}` }] : []),
			{ id: "confirm", label: "Conferma e salva", hint: "invio" },
		];
	}

	invalidate(): void {}

	private submit(): void {
		if (!this.values.title.trim()) {
			this.index = 0;
			this.error = "Il titolo è obbligatorio.";
			return this.requestRender();
		}
		this.done({ ...this.values, title: this.values.title.trim(), happened: this.values.happened.trim(), expected: this.values.expected.trim() });
	}

	handleInput(data: string): void {
		const printable = decodeKittyPrintable(data) ?? (data.length === 1 && data >= " " && data !== "\x7f" ? data : undefined);
		const row = this.rows[this.index];
		this.error = "";
		if (matchesKey(data, "escape")) return this.done(undefined);
		if (matchesKey(data, "ctrl+s")) return this.submit();
		if (matchesKey(data, "tab") || matchesKey(data, "down")) this.index = (this.index + 1) % this.rows.length;
		else if (matchesKey(data, "shift+tab") || matchesKey(data, "up")) this.index = (this.index + this.rows.length - 1) % this.rows.length;
		else if (row.id === "title" || row.id === "happened" || row.id === "expected") {
			if (matchesKey(data, "enter")) this.index++;
			else if (matchesKey(data, "backspace")) this.values[row.id] = this.values[row.id].slice(0, -1);
			else if (printable) this.values[row.id] += printable;
		} else if (row.id === "severity") {
			const step = matchesKey(data, "left") ? -1 : matchesKey(data, "right") || printable === " " ? 1 : 0;
			if (step) this.values.severity = SEVERITIES[(SEVERITIES.indexOf(this.values.severity) + step + SEVERITIES.length) % SEVERITIES.length];
			else if (matchesKey(data, "enter")) this.index++;
		} else if (row.id === "redact" || row.id === "send") {
			if (printable === " " || matchesKey(data, "left") || matchesKey(data, "right")) this.values[row.id] = !this.values[row.id];
			else if (matchesKey(data, "enter")) this.index++;
		} else if (matchesKey(data, "enter")) return this.submit();
		this.requestRender();
	}

	render(width: number): string[] {
		const t = this.theme;
		const inner = Math.max(20, width - 4);
		const lines: string[] = [];
		const push = (text = "") => lines.push(`${t.fg("border", "│")} ${truncateToWidth(text, inner, "…")}${" ".repeat(Math.max(0, inner - visibleWidth(truncateToWidth(text, inner, "…"))))} ${t.fg("border", "│")}`);
		lines.push(t.fg("border", `╭${"─".repeat(width - 2)}╮`));
		push(`${t.fg("accent", t.bold("🐞 SEGNALA UN BUG"))}   ${t.fg("muted", "tab/↑↓ campi · ctrl+s conferma · esc annulla")}`);
		push(t.fg("dim", "Salvo sessione, chat, memoria, goal, intent, todo e ambiente: tutto, per poterlo analizzare."));
		push();
		this.rows.forEach((row, i) => {
			const on = i === this.index;
			const mark = on ? t.fg("accent", "›") : " ";
			const label = on ? t.fg("accent", t.bold(row.label)) : t.fg("text", row.label);
			if (row.id === "title" || row.id === "happened" || row.id === "expected") {
				push(`${mark} ${label}  ${t.fg("dim", on ? row.hint : "")}`);
				const value = this.values[row.id];
				const wrapped = value ? wrapTextWithAnsi(value, inner - 6) : [""];
				wrapped.slice(-4).forEach((part, k, all) => push(`    ${t.fg("text", part)}${on && k === all.length - 1 ? `${this.focused ? CURSOR_MARKER : ""}${t.fg("accent", "▏")}` : ""}`));
			} else if (row.id === "severity") {
				push(`${mark} ${label}   ${SEVERITIES.map((s) => (s === this.values.severity ? t.fg("accent", t.bold(`[${SEVERITY_TEXT[s]}]`)) : t.fg("muted", ` ${SEVERITY_TEXT[s]} `))).join(" ")}`);
			} else if (row.id === "confirm") {
				push();
				push(`${mark} ${on ? t.fg("success", t.bold(`[ ${row.label} ]`)) : t.fg("muted", `[ ${row.label} ]`)}  ${t.fg("dim", on ? row.hint : "")}`);
			} else {
				const checked = this.values[row.id];
				push(`${mark} ${checked ? t.fg("success", "[x]") : t.fg("muted", "[ ]")} ${label}  ${t.fg("dim", on ? row.hint : "")}`);
			}
		});
		if (this.error) {
			push();
			push(t.fg("error", this.error));
		}
		while (lines.length < Math.min(this.height(), 22) - 1) push();
		lines.push(t.fg("border", `╰${"─".repeat(width - 2)}╯`));
		return lines;
	}
}
