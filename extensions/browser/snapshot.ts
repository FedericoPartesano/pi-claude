/**
 * What the model reads of a page: the accessibility tree (CDP Accessibility.getFullAXTree) cut to what can be acted on
 * or read — interactive elements with a stable ref ([e12] button "Salva"), headings and text — instead of HTML or
 * pixels. Refs survive between snapshots (keyed by the DOM node), so after an action only the difference is sent.
 */
export interface AXValue {
	value?: unknown;
}

export interface AXNode {
	nodeId: string;
	ignored?: boolean;
	role?: AXValue;
	name?: AXValue;
	value?: AXValue;
	properties?: { name: string; value: AXValue }[];
	childIds?: string[];
	backendDOMNodeId?: number;
}

/** Roles the model can act on: they get a ref. */
const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "switch", "slider", "spinbutton", "treeitem"]);
/** Roles worth a line without a ref (structure and content). */
const CONTENT = new Set(["heading", "img", "alert", "status", "dialog", "alertdialog", "cell", "columnheader", "rowheader"]);
/** Shown as "text": the visible words. */
const TEXT = new Set(["StaticText", "text"]);
/** States worth showing next to an element. */
const STATES = ["disabled", "checked", "selected", "expanded", "pressed", "required", "invalid", "focused", "level"];

/** ref ↔ DOM node: the same element keeps its ref across snapshots of one page session. */
export class RefTable {
	private byBackend = new Map<number, string>();
	private byRef = new Map<string, number>();
	private next = 1;

	refFor(backendId: number): string {
		let ref = this.byBackend.get(backendId);
		if (!ref) {
			ref = `e${this.next++}`;
			this.byBackend.set(backendId, ref);
			this.byRef.set(ref, backendId);
		}
		return ref;
	}

	backendId(ref: string): number | undefined {
		return this.byRef.get(ref);
	}

	/** A new document (navigation): old refs mean nothing there. */
	reset(): void {
		this.byBackend.clear();
		this.byRef.clear();
		this.next = 1;
	}
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
const str = (value: unknown) => (value === undefined || value === null ? "" : String(value)).replace(/\s+/g, " ").trim();

function states(node: AXNode): string {
	const out: string[] = [];
	for (const property of node.properties ?? []) {
		if (!STATES.includes(property.name)) continue;
		const value = property.value?.value;
		if (value === false || value === undefined || value === "false") continue;
		out.push(value === true || value === "true" ? property.name : `${property.name}=${str(value)}`);
	}
	return out.length ? ` [${out.join(", ")}]` : "";
}

export interface SnapshotOptions {
	/** Budget in characters (≈ 4 per token); beyond it a note says how much was left out. */
	maxChars?: number;
}

/** One line per element worth reading, in document order, indented by nothing (flat lists read best). */
export function compactSnapshot(nodes: AXNode[], refs: RefTable, options: SnapshotOptions = {}): string {
	const maxChars = options.maxChars ?? 6000;
	const byId = new Map(nodes.map((node) => [node.nodeId, node]));
	const childOf = new Set(nodes.flatMap((node) => node.childIds ?? []));
	const roots = nodes.filter((node) => !childOf.has(node.nodeId));
	const lines: string[] = [];
	let lastText = "";
	const visit = (node: AXNode | undefined, depth: number) => {
		if (!node || depth > 200) return;
		const role = str(node.role?.value);
		const name = clip(str(node.name?.value), 100);
		if (!node.ignored) {
			if (INTERACTIVE.has(role) && node.backendDOMNodeId !== undefined) {
				const value = str(node.value?.value);
				lines.push(`- [${refs.refFor(node.backendDOMNodeId)}] ${role} "${name}"${value && value !== name ? ` = "${clip(value, 60)}"` : ""}${states(node)}`);
				lastText = name;
				return; // its children are its own label
			}
			if (CONTENT.has(role) && name) {
				lines.push(`- ${role} "${name}"${states(node)}`);
				lastText = name;
			} else if (TEXT.has(role) && name.length > 1 && name !== lastText) {
				lines.push(`- text "${clip(name, 160)}"`);
				lastText = name;
			}
		}
		for (const child of node.childIds ?? []) visit(byId.get(child), depth + 1);
	};
	for (const root of roots) visit(root, 0);
	let out = "";
	for (const [index, line] of lines.entries()) {
		if (out.length + line.length + 1 > maxChars) {
			out += `\n… altri ${lines.length - index} elementi (snapshot con scope=<ref> per leggere una parte)`;
			return out.trimStart();
		}
		out += `${out ? "\n" : ""}${line}`;
	}
	return out;
}

/** Lines removed (- ) and added (+ ) between two snapshots, in order; "(nessun cambiamento)" when equal. */
export function diffSnapshot(before: string, after: string, maxLines = 80): string {
	if (before === after) return "(nessun cambiamento)";
	const was = before.split("\n");
	const now = after.split("\n");
	const wasSet = new Set(was);
	const nowSet = new Set(now);
	const removed = was.filter((line) => !nowSet.has(line)).map((line) => `- ${line}`);
	const added = now.filter((line) => !wasSet.has(line)).map((line) => `+ ${line}`);
	const all = [...removed, ...added];
	if (all.length === 0) return "(stesso contenuto, ordine diverso)";
	return all.length > maxLines ? `${all.slice(0, maxLines).join("\n")}\n… altre ${all.length - maxLines} differenze` : all.join("\n");
}
