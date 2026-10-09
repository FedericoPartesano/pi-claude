/**
 * One browser session: a Chrome (started or attached), its page, the ref table and the last snapshot. Every method
 * returns the text the model reads: a compact snapshot after opening a page, only the difference after an action.
 */
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CdpPage, pageTarget } from "./cdp.ts";
import { startChrome, type RunningChrome } from "./chrome.ts";
import { compactSnapshot, diffSnapshot, nameOf, RefTable, type AXNode } from "./snapshot.ts";

const KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
	Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
	Tab: { key: "Tab", code: "Tab", keyCode: 9 },
	Escape: { key: "Escape", code: "Escape", keyCode: 27 },
	Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
	ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
	ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
	ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
	ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
	PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
	PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
};

export type ActKind = "click" | "type" | "select" | "press" | "hover";

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}… (${text.length - max} caratteri in più)`);

export class BrowserSession {
	private chrome?: RunningChrome;
	private page?: CdpPage;
	private refs = new RefTable();
	private last = "";
	private url = "";
	private logLines: string[] = [];
	readonly shotsDir: string;
	/** Where downloads land (the project's .pi/downloads): no dialog, and Pi can list them. */
	readonly downloadsDir?: string;

	constructor(options: { shotsDir?: string; downloadsDir?: string } = {}) {
		this.shotsDir = options.shotsDir ?? join(homedir(), ".cache", "pi-browser", "shots");
		this.downloadsDir = options.downloadsDir;
	}

	/** Files downloaded so far, newest first (size, time). */
	downloads(): string {
		if (!this.downloadsDir) return "(cartella dei download non impostata)";
		let files: { name: string; size: number; time: number }[] = [];
		try {
			files = readdirSync(this.downloadsDir)
				.filter((name) => !name.endsWith(".crdownload"))
				.map((name) => {
					const stat = statSync(join(this.downloadsDir!, name));
					return { name, size: stat.size, time: stat.mtimeMs };
				})
				.sort((a, b) => b.time - a.time);
		} catch {
			// Nothing downloaded yet.
		}
		if (!files.length) return `Nessun download in ${this.downloadsDir}`;
		return files.slice(0, 30).map((file) => `${join(this.downloadsDir!, file.name)} · ${Math.max(1, Math.round(file.size / 1024))} KB · ${new Date(file.time).toLocaleString("it-IT")}`).join("\n");
	}

	get attached(): boolean {
		return Boolean(this.chrome?.attached);
	}

	get currentUrl(): string {
		return this.url;
	}

	private async ensure(): Promise<CdpPage> {
		if (this.page && !this.page.closed) return this.page;
		this.chrome ??= await startChrome();
		const target = await pageTarget(this.chrome.endpoint);
		const page = await CdpPage.connect(target.webSocketDebuggerUrl);
		await Promise.all([page.send("Page.enable"), page.send("DOM.enable"), page.send("Accessibility.enable"), page.send("Runtime.enable"), page.send("Log.enable")]);
		const log = (line: string) => {
			this.logLines.push(clip(line.replace(/\s+/g, " "), 300));
			if (this.logLines.length > 50) this.logLines.shift();
		};
		page.on("Runtime.consoleAPICalled", (event) => {
			if (event.type === "error" || event.type === "warning") log(`console.${event.type}: ${(event.args ?? []).map((arg: { value?: unknown; description?: string }) => arg.value ?? arg.description ?? "").join(" ")}`);
		});
		page.on("Runtime.exceptionThrown", (event) => log(`eccezione: ${event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text ?? ""}`));
		page.on("Log.entryAdded", (event) => {
			if (event.entry?.level === "error") log(`${event.entry.source}: ${event.entry.text}${event.entry.url ? ` (${event.entry.url})` : ""}`);
		});
		if (this.downloadsDir) {
			mkdirSync(this.downloadsDir, { recursive: true });
			// Chrome: save without asking (Pi Desk sets this itself; there the Browser domain may be missing).
			await page.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: this.downloadsDir }).catch(() => undefined);
		}
		this.page = page;
		this.url = target.url;
		return page;
	}

	private async readTree(scopeRef?: string): Promise<string> {
		const page = await this.ensure();
		const { nodes } = await page.send<{ nodes: AXNode[] }>("Accessibility.getFullAXTree");
		let list = nodes;
		if (scopeRef) {
			const backend = this.refs.backendId(scopeRef);
			const root = backend === undefined ? undefined : nodes.find((node) => node.backendDOMNodeId === backend);
			if (!root) throw new Error(`Riferimento ${scopeRef} non trovato: rileggi la pagina con snapshot.`);
			const byId = new Map(nodes.map((node) => [node.nodeId, node]));
			const keep: AXNode[] = [];
			const walk = (node: AXNode | undefined) => {
				if (!node) return;
				keep.push(node);
				for (const child of node.childIds ?? []) walk(byId.get(child));
			};
			walk({ ...root, role: { value: "group" } });
			list = keep;
		}
		return compactSnapshot(list, this.refs);
	}

	private async waitForLoad(page: CdpPage, timeoutMs: number): Promise<void> {
		await page.once("Page.loadEventFired", timeoutMs);
		await new Promise((resolve) => setTimeout(resolve, 150));
	}

	private header(): string {
		return `${this.url}`;
	}

	async open(url: string): Promise<string> {
		const page = await this.ensure();
		const loaded = page.once("Page.loadEventFired", 20_000);
		const result = await page.send<{ errorText?: string }>("Page.navigate", { url });
		if (result.errorText) throw new Error(`Pagina non aperta: ${result.errorText}`);
		await loaded;
		await new Promise((resolve) => setTimeout(resolve, 150));
		this.refs.reset();
		this.url = await this.location();
		this.last = await this.readTree();
		return `${this.header()}\n${this.last}`;
	}

	async snapshot(scope?: string): Promise<string> {
		const text = await this.readTree(scope);
		if (!scope) {
			this.url = await this.location();
			this.last = text;
		}
		return `${this.header()}${scope ? ` · ${scope}` : ""}\n${text}`;
	}

	private async location(): Promise<string> {
		const page = await this.ensure();
		const { result } = await page.send<{ result: { value?: string } }>("Runtime.evaluate", { expression: "location.href", returnByValue: true });
		return result.value ?? this.url;
	}

	/** Acts on a ref, then returns what changed (a whole snapshot when the page navigated). */
	async act(ref: string, kind: ActKind, text?: string): Promise<string> {
		const page = await this.ensure();
		const backendNodeId = this.refs.backendId(ref);
		if (backendNodeId === undefined) throw new Error(`Riferimento ${ref} sconosciuto: rileggi la pagina con snapshot.`);
		const before = this.url;
		const name = nameOf(this.last, ref);
		await this.show(backendNodeId, `◆ ${kind}${name ? ` «${name.slice(0, 40)}»` : ""}`);
		const navigated = page.once("Page.frameNavigated", 1200);
		if (kind === "click" || kind === "hover") {
			await page.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => undefined);
			const { quads } = await page.send<{ quads: number[][] }>("DOM.getContentQuads", { backendNodeId });
			if (!quads?.length) throw new Error(`${ref} non è visibile (nessuna area cliccabile).`);
			const q = quads[0];
			const x = (q[0] + q[2] + q[4] + q[6]) / 4;
			const y = (q[1] + q[3] + q[5] + q[7]) / 4;
			await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
			if (kind === "click") {
				await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
				await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
			}
		} else if (kind === "type") {
			const { object } = await page.send<{ object: { objectId: string } }>("DOM.resolveNode", { backendNodeId });
			await page.send("DOM.focus", { backendNodeId });
			// Replace what is there (a field is filled, not appended to).
			await page.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function(){ if (this.select) this.select(); else if (this.isContentEditable) document.execCommand('selectAll'); }" });
			await page.send("Input.insertText", { text: text ?? "" });
		} else if (kind === "select") {
			const { object } = await page.send<{ object: { objectId: string } }>("DOM.resolveNode", { backendNodeId });
			const { result } = await page.send<{ result: { value?: boolean } }>("Runtime.callFunctionOn", {
				objectId: object.objectId,
				functionDeclaration: "function(choice){ const option = [...(this.options||[])].find(o => o.value === choice || o.textContent.trim() === choice); if (!option) return false; this.value = option.value; this.dispatchEvent(new Event('input', {bubbles:true})); this.dispatchEvent(new Event('change', {bubbles:true})); return true; }",
				arguments: [{ value: text ?? "" }],
				returnByValue: true,
			});
			if (!result.value) throw new Error(`Opzione "${text}" non trovata in ${ref}.`);
		} else if (kind === "press") {
			const key = KEYS[text ?? ""];
			if (!key) throw new Error(`Tasto non supportato: ${text}. Usa uno di ${Object.keys(KEYS).join(", ")}.`);
			await page.send("DOM.focus", { backendNodeId }).catch(() => undefined);
			await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, text: key.text });
			await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode });
		}
		// Let the page react: a navigation waits for the new page, otherwise a short settle.
		if (await navigated) await this.waitForLoad(page, 15_000);
		else await new Promise((resolve) => setTimeout(resolve, 300));
		this.url = await this.location();
		if (this.url !== before) {
			this.refs.reset();
			this.last = await this.readTree();
			return `${this.header()} (nuova pagina)\n${this.last}`;
		}
		const now = await this.readTree();
		const diff = diffSnapshot(this.last, now);
		this.last = now;
		return `${this.header()}\n${diff}`;
	}

	/**
	 * The element Pi is about to act on, lit up for a moment so whoever watches the window sees it (cyan, Neon Night).
	 * Only with a visible window; PI_BROWSER_SHOW=0 turns it off. Never fails the action.
	 */
	private async show(backendNodeId: number, label = ""): Promise<void> {
		if (process.env.PI_BROWSER_HEADLESS === "1" || process.env.PI_BROWSER_SHOW === "0") return;
		const page = this.page!;
		try {
			await page.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => undefined);
			await page.send("Overlay.enable");
			await page.send("Overlay.highlightNode", {
				backendNodeId,
				highlightConfig: { contentColor: { r: 46, g: 230, b: 255, a: 0.22 }, borderColor: { r: 46, g: 230, b: 255, a: 0.95 }, paddingColor: { r: 255, g: 63, b: 216, a: 0.12 }, showInfo: false },
			});
			const ms = Number(process.env.PI_BROWSER_SHOW_MS ?? 450);
			// What Pi is doing, written above the element ("◆ click «Aggiungi»"). aria-hidden and in a shadow root: it is
			// not in the accessibility tree Pi reads, nor in the page's styles; it goes away by itself.
			if (label) {
				const { object } = await page.send<{ object: { objectId: string } }>("DOM.resolveNode", { backendNodeId });
				await page.send("Runtime.callFunctionOn", { objectId: object.objectId, arguments: [{ value: label }, { value: ms + 700 }], functionDeclaration: SHOW_LABEL });
			}
			await new Promise((resolve) => setTimeout(resolve, ms));
			await page.send("Overlay.hideHighlight");
		} catch {
			// No overlay domain (some embedders): act anyway.
		}
	}

	async evaluate(expression: string): Promise<string> {
		const page = await this.ensure();
		const { result, exceptionDetails } = await page.send<{ result: { value?: unknown; description?: string; type: string }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, timeout: 10_000 });
		if (exceptionDetails) return `errore: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`;
		const value = result.value === undefined ? (result.description ?? result.type) : typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 1);
		return clip(String(value), 4000);
	}

	async screenshot(ref?: string): Promise<{ path: string; base64: string }> {
		const page = await this.ensure();
		let clipArea: object | undefined;
		if (ref) {
			const backendNodeId = this.refs.backendId(ref);
			if (backendNodeId === undefined) throw new Error(`Riferimento ${ref} sconosciuto.`);
			await page.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => undefined);
			const { model } = await page.send<{ model: { border: number[]; width: number; height: number } }>("DOM.getBoxModel", { backendNodeId });
			clipArea = { x: model.border[0], y: model.border[1], width: model.width, height: model.height, scale: 1 };
		}
		const { data } = await page.send<{ data: string }>("Page.captureScreenshot", { format: "png", ...(clipArea ? { clip: clipArea } : {}) });
		mkdirSync(this.shotsDir, { recursive: true });
		const path = join(this.shotsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
		writeFileSync(path, Buffer.from(data, "base64"));
		return { path, base64: data };
	}

	logs(): string {
		const lines = this.logLines.splice(0);
		return lines.length ? lines.join("\n") : "(nessun errore in console o in rete dall'ultima lettura)";
	}

	close(): void {
		this.page?.close();
		if (this.chrome && !this.chrome.attached) this.chrome.process?.kill();
		this.page = undefined;
		this.chrome = undefined;
	}
}

/** Runs on the element: a small cyan label just above it, gone after `ms`. */
const SHOW_LABEL = `function (label, ms) {
	const r = this.getBoundingClientRect();
	const host = document.createElement("div");
	host.setAttribute("aria-hidden", "true");
	host.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;left:" + Math.max(4, r.left) + "px;top:" + Math.max(4, r.top - 26) + "px";
	const tag = host.attachShadow({ mode: "closed" }).appendChild(document.createElement("span"));
	tag.textContent = label;
	tag.style.cssText = "display:block;padding:3px 7px;border:1px solid #2ee6ff;background:#0c0c0f;color:#2ee6ff;font:11px/1.3 'JetBrains Mono',ui-monospace,monospace;white-space:nowrap";
	document.documentElement.appendChild(host);
	setTimeout(() => host.remove(), ms);
}`;
