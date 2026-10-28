/**
 * The Micelio panel as a pi-tui component, with everything pi-tui gives injected (`matches`, `paint`), so it runs in a
 * plain test. A click or ↑↓ choose a card, Enter or Space open and close it, Esc gives the keys back to the chat and
 * the panel's own key (or Q) closes the panel.
 */
import { cardLines, keyLabel, legendLines, wrapPlain, type Memory, type Paint, type Shortcut } from "./memories.ts";

export interface PanelData {
	status: "idle" | "loading" | "ok" | "offline";
	query: string;
	memories: Memory[];
}

export interface PanelDeps {
	read: () => PanelData;
	paint: Paint;
	/** Header and hint colours: `muted` for the dim text, `accent` for the name. */
	text: { name: (text: string) => string; dim: (text: string) => string };
	matches: (data: string, key: string) => boolean;
	/** The panel's own shortcut, which closes it. */
	key: string;
	/** Esc or the focus key: the keys go back to the chat, the panel stays. */
	blur: () => void;
	/** The key that moves the keyboard between chat and panel (shown in the hint). */
	focusKey: string;
	/** Does the panel hold the keyboard now? Only then a card is marked as chosen. */
	focused: () => boolean;
	rows: () => number;
	done: () => void;
	requestRender: () => void;
}

export class PanelView {
	private readonly deps: PanelDeps;
	private readonly open = new Set<string>();
	private selected = 0;
	private scroll = 0;
	/** Rows of each card in the body, to turn a click into a card. */
	private spans: { start: number; end: number }[] = [];
	private headRows = 0;

	constructor(deps: PanelDeps) {
		this.deps = deps;
	}

	render(width: number): string[] {
		const { status, query, memories } = this.deps.read();
		const { text, paint } = this.deps;
		const summary = status === "offline" ? "non raggiungibile" : status === "loading" ? "ricerca…" : status === "idle" ? "in attesa" : `${memories.length} ${memories.length === 1 ? "ricordo" : "ricordi"} · «${query}»`;
		// Nothing is cut to the width: the summary and the hint wrap like everything else.
		const title = wrapPlain(`Micelio ${summary}`, Math.max(10, width - 1)).map((row, index) => (index === 0 && row.startsWith("Micelio") ? ` ${text.name("Micelio")}${text.dim(row.slice(7))}` : ` ${text.dim(row)}`));
		const head = [...title, paint.frame("─".repeat(width), false)];
		this.headRows = head.length;
		const foot = [paint.frame("─".repeat(width), false), ...legendLines(this.shortcuts(), width, paint)];
		this.selected = Math.min(this.selected, Math.max(0, memories.length - 1));
		const body: string[] = [];
		let top = 0;
		let bottom = 0;
		this.spans = [];
		memories.forEach((memory, index) => {
			const card = cardLines(memory, width, this.open.has(memory.id), index === this.selected && this.deps.focused(), paint);
			if (index === this.selected) {
				top = body.length;
				bottom = body.length + card.length;
			}
			this.spans.push({ start: body.length, end: body.length + card.length });
			body.push(...card);
		});
		if (!memories.length && (status === "ok" || status === "offline")) for (const row of wrapPlain(status === "ok" ? "Micelio non ha restituito ricordi." : "Micelio non risponde: riprovo al prossimo prompt.", Math.max(10, width - 1))) body.push(` ${text.dim(row)}`);
		const room = Math.max(4, this.deps.rows() - head.length - foot.length);
		if (top < this.scroll) this.scroll = top;
		if (bottom > this.scroll + room) this.scroll = Math.min(top, bottom - room);
		return [...head, ...body.slice(this.scroll, this.scroll + room), ...foot];
	}

	handleInput(data: string): void {
		const { memories } = this.deps.read();
		const { matches, key } = this.deps;
		if (matches(data, key) || matches(data, "q")) return this.deps.done();
		if (matches(data, "escape") || matches(data, this.deps.focusKey)) return this.deps.blur();
		if (matches(data, "up")) this.selected = Math.max(0, this.selected - 1);
		else if (matches(data, "down")) this.selected = Math.min(Math.max(0, memories.length - 1), this.selected + 1);
		else if (matches(data, "enter") || matches(data, "space")) {
			const id = memories[this.selected]?.id;
			if (id) this.open.has(id) ? this.open.delete(id) : this.open.add(id);
		}
		this.deps.requestRender();
	}

	/** A click on a card chooses it and opens or closes it. */
	handleMouse(event: { type: string; button?: string; y: number }): { handled: true; render: true; focus?: true } | undefined {
		if (event.type !== "click" || event.button !== "left") return undefined;
		const row = event.y - this.headRows + this.scroll;
		const index = this.spans.findIndex((span) => row >= span.start && row < span.end);
		if (index === -1) return { handled: true, render: true, focus: true };
		this.selected = index;
		const id = this.deps.read().memories[index]?.id;
		if (id) this.open.has(id) ? this.open.delete(id) : this.open.add(id);
		return { handled: true, render: true, focus: true };
	}

	/** The legend: what the keys do now. With the keyboard in the chat only the way in is shown. */
	private shortcuts(): Shortcut[] {
		const { key, focusKey } = this.deps;
		if (!this.deps.focused()) {
			return [
				{ keys: [keyLabel(focusKey)], label: "Tastiera nel pannello" },
				{ keys: ["Clic"], label: "Scegli una card" },
				{ keys: [keyLabel(key)], label: "Chiudi il pannello" },
			];
		}
		return [
			{ keys: ["↑", "↓"], label: "Scegli una card" },
			{ keys: ["Invio"], label: "Apri o chiudi la card" },
			{ keys: ["Esc", keyLabel(focusKey)], label: "Torna alla chat" },
			{ keys: ["Q", keyLabel(key)], label: "Chiudi il pannello" },
		];
	}

	invalidate(): void {}
}
