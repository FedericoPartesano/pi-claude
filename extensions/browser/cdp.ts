/**
 * A minimal Chrome DevTools Protocol client over Node's built-in WebSocket (no Playwright, no Puppeteer): commands with
 * ids and replies, events by method, one page target. Enough to navigate, read the accessibility tree, act and capture.
 */
export class CdpPage {
	private socket: WebSocket;
	private nextId = 1;
	private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	private listeners = new Map<string, Set<(params: any) => void>>();
	closed = false;

	private constructor(socket: WebSocket) {
		this.socket = socket;
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data));
			if (message.id !== undefined) {
				const waiter = this.pending.get(message.id);
				this.pending.delete(message.id);
				if (message.error) waiter?.reject(new Error(message.error.message));
				else waiter?.resolve(message.result);
			} else if (message.method) for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
		});
		socket.addEventListener("close", () => {
			this.closed = true;
			for (const waiter of this.pending.values()) waiter.reject(new Error("connessione a Chrome chiusa"));
			this.pending.clear();
		});
	}

	static async connect(webSocketUrl: string, timeoutMs = 5000): Promise<CdpPage> {
		const socket = new WebSocket(webSocketUrl);
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("Chrome non risponde")), timeoutMs);
			socket.addEventListener("open", () => (clearTimeout(timer), resolve()), { once: true });
			socket.addEventListener("error", () => (clearTimeout(timer), reject(new Error("connessione a Chrome non riuscita"))), { once: true });
		});
		return new CdpPage(socket);
	}

	send<T = any>(method: string, params: object = {}, timeoutMs = 30_000): Promise<T> {
		if (this.closed) return Promise.reject(new Error("connessione a Chrome chiusa"));
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method}: Chrome non ha risposto in ${Math.round(timeoutMs / 1000)}s`));
			}, timeoutMs);
			this.pending.set(id, { resolve: (value) => (clearTimeout(timer), resolve(value)), reject: (error) => (clearTimeout(timer), reject(error)) });
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	on(method: string, listener: (params: any) => void): () => void {
		const set = this.listeners.get(method) ?? new Set();
		set.add(listener);
		this.listeners.set(method, set);
		return () => set.delete(listener);
	}

	/** Resolves on the next event of this kind (or after timeoutMs, with undefined). */
	once(method: string, timeoutMs: number): Promise<any> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => (off(), resolve(undefined)), timeoutMs);
			const off = this.on(method, (params) => (clearTimeout(timer), off(), resolve(params)));
		});
	}

	close(): void {
		this.socket.close();
	}
}

/** The first page target of a Chrome debugging endpoint (http://127.0.0.1:<port>), created if there is none. */
export async function pageTarget(endpoint: string): Promise<{ webSocketDebuggerUrl: string; url: string }> {
	const list = (await (await fetch(`${endpoint}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
	const page = list.find((target) => target.type === "page" && !target.url.startsWith("devtools://"));
	if (page) return page;
	return (await (await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" })).json()) as { webSocketDebuggerUrl: string; url: string };
}
