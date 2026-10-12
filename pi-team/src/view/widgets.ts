/**
 * Small drawing pieces of the agents view: theme roles, framed cards, chips, keycaps, segmented progress,
 * sparklines and scrollbars. Pure functions over strings; every result fits the width it is given.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type Fg =
	| "accent" | "border" | "borderAccent" | "borderMuted" | "success" | "error" | "warning" | "muted" | "dim" | "text"
	| "thinkingText" | "toolTitle" | "toolOutput" | "scrollbarTrack" | "scrollbarThumb" | "mdCode";
export type Bg = "selectedBg" | "customMessageBg" | "toolPendingBg" | "toolSuccessBg" | "toolErrorBg" | "userMessageBg";

/** The part of Pi's theme the view uses (Pi's `Theme` fits as is), so it follows /theme. */
export interface ViewTheme {
	fg(role: Fg, text: string): string;
	bg(role: Bg, text: string): string;
	bold(text: string): string;
	italic(text: string): string;
}

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - visibleWidth(text)));
export const fit = (text: string, width: number) => pad(truncateToWidth(text, Math.max(0, width)), width);
export const padStart = (text: string, width: number) => " ".repeat(Math.max(0, width - visibleWidth(text))) + text;

/** `left` and `right` on one line of `width`: the right part stays whole, the left one is cut. */
export function spread(left: string, right: string, width: number): string {
	const room = width - visibleWidth(right);
	if (room < 4) return fit(left, width);
	return pad(truncateToWidth(left, room - 1), room) + right;
}

export function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 10_000) return `${Math.round(count / 1000)}k`;
	if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
	return String(count);
}

export function formatDuration(seconds: number): string {
	const total = Math.max(0, Math.round(seconds));
	if (total < 60) return `${total}s`;
	const minutes = Math.floor(total / 60);
	if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** ` esc ` on a raised background, then its label. */
export function keycap(theme: ViewTheme, key: string, label: string): string {
	return `${theme.bg("customMessageBg", theme.bold(theme.fg("text", ` ${key} `)))} ${theme.fg("muted", label)}`;
}

/** A pill: bold text on a background (selected) or plain colored text. */
export function chip(theme: ViewTheme, text: string, role: Fg, selected = false): string {
	return selected ? theme.bg("selectedBg", theme.bold(theme.fg(role, ` ${text} `))) : theme.fg(role, ` ${text} `);
}

/** ▁▂▃▅▇ of the values, the last `width` of them, scaled to the largest. */
export function sparkline(values: number[], width: number): string {
	const bars = "▁▂▃▄▅▆▇█";
	const shown = values.slice(-width);
	const max = Math.max(1, ...shown);
	return shown.map((value) => bars[Math.min(bars.length - 1, Math.floor((value / max) * (bars.length - 1)))]).join("");
}

export interface Segment {
	role: Fg;
	char: string;
}

/** One cell per segment, stretched to `width` when there are fewer segments than cells. */
export function segmentBar(theme: ViewTheme, segments: Segment[], width: number): string {
	if (segments.length === 0 || width <= 0) return " ".repeat(Math.max(0, width));
	const cells: string[] = [];
	for (let cell = 0; cell < width; cell++) {
		const segment = segments[Math.min(segments.length - 1, Math.floor((cell * segments.length) / width))]!;
		// A thin gap between stretched segments keeps them countable.
		const edge = segments.length > 1 && segments.length * 3 <= width && Math.floor(((cell + 1) * segments.length) / width) !== Math.floor((cell * segments.length) / width) && cell < width - 1;
		cells.push(edge ? " " : theme.fg(segment.role, segment.char));
	}
	return cells.join("");
}

/** Characters of a vertical scrollbar of `height` rows: thumb where the viewport is. */
export function scrollbar(total: number, viewport: number, offsetFromTop: number, height: number): boolean[] {
	if (total <= viewport || height <= 0) return Array.from({ length: height }, () => false);
	const size = Math.max(1, Math.round((viewport / total) * height));
	const start = Math.min(height - size, Math.round((offsetFromTop / Math.max(1, total - viewport)) * (height - size)));
	return Array.from({ length: height }, (_, row) => row >= start && row < start + size);
}

export interface FrameOptions {
	title: string;
	/** Right side of the top border (e.g. attempt, time). */
	badge?: string;
	color: Fg;
	/** Rows of the right border drawn as a scrollbar thumb. */
	thumb?: boolean[];
	/** Text inside the bottom border. */
	footer?: string;
}

/**
 * A rounded card of exactly `width` × `height`: title and badge in the top border, one column of padding,
 * the lines inside cut or padded to fit.
 */
export function frame(theme: ViewTheme, lines: string[], width: number, height: number, options: FrameOptions): string[] {
	const color = (text: string) => theme.fg(options.color, text);
	const inner = Math.max(0, width - 2);
	const content = Math.max(0, width - 4);
	const badge = options.badge ? ` ${options.badge} ` : "";
	const titleRoom = Math.max(0, inner - 2 - visibleWidth(badge) - 1);
	const title = truncateToWidth(` ${options.title} `, titleRoom);
	const top = `${color("╭─")}${title}${color("─".repeat(Math.max(0, inner - 1 - visibleWidth(title) - visibleWidth(badge))))}${badge}${color("╮")}`;
	const footer = options.footer ? truncateToWidth(` ${options.footer} `, Math.max(0, inner - 2)) : "";
	const bottom = `${color("╰─")}${footer}${color("─".repeat(Math.max(0, inner - 1 - visibleWidth(footer))))}${color("╯")}`;
	const rows = Math.max(0, height - 2);
	const body = Array.from({ length: rows }, (_, row) => {
		const right = options.thumb?.[row] ? theme.fg("scrollbarThumb", "┃") : color("│");
		return `${color("│")} ${fit(lines[row] ?? "", content)} ${right}`;
	});
	return [top, ...body, bottom].slice(0, Math.max(0, height));
}
