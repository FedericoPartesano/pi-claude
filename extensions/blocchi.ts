/**
 * /blocchi — a local web page that shows, live, what billion-context folded out of the session: the compress blocks
 * (topic, summary, size, nesting) and, on click, the original messages of a block (a read-only decompress: the
 * conversation is untouched). Costs no tokens: a command, no tool, nothing in the prompt.
 *
 * Also runs alone: `node extensions/blocchi.ts [session.jsonl]` (no argument: follows the newest Pi session).
 *
 * The server listens on 127.0.0.1 only, every request needs the random token of the URL, and the Host header must be
 * the loopback address (no DNS rebinding). Session text reaches the page as JSON and is rendered with textContent.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { type FSWatcher, readdirSync, readFileSync, statSync, watch } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Entry = { type?: string; id?: string; message?: { role?: string; toolName?: string; toolCallId?: string; content?: unknown } };
type Block = { blockId: string; topic?: string; summary?: string; tier?: string | number; active?: boolean; compressedTokens?: number; directBlockIds?: string[]; directMessageIds?: string[]; effectiveMessageIds?: string[]; createdAt?: number };
type State = { blocks?: Block[]; messageRefs?: { byRaw?: Record<string, string> }; tokenSnapshot?: Record<string, number> };
export type Part = { kind: "text" | "thinking" | "tool" | "result" | "image"; text: string };
export type Message = { id: string; role: string; label: string; parts: Part[] };
export type BlockView = { blockId: string; topic: string; summary: string; tier: string; active: boolean; tokens: number; messages: number; createdAt?: number; children: BlockView[] };

const ROLES = new Set(["user", "assistant", "toolResult"]);
const base = (ref: string) => ref.split("#")[0];

/** Blocks as a tree (a block absorbed by a later one sits under it), plus totals of the live context. */
export function blockTree(state: State, entries: readonly Entry[]) {
	const blocks = state.blocks ?? [];
	const byId = new Map(blocks.map((b) => [b.blockId, b]));
	const nested = new Set(blocks.flatMap((b) => b.directBlockIds ?? []));
	const view = (b: Block, seen: Set<string>): BlockView => ({
		blockId: b.blockId,
		topic: b.topic ?? b.blockId,
		summary: b.summary ?? "",
		tier: String(b.tier ?? 1),
		active: Boolean(b.active),
		tokens: Number(b.compressedTokens ?? 0),
		messages: new Set((b.effectiveMessageIds ?? []).map(base)).size,
		createdAt: b.createdAt === undefined ? undefined : Number(b.createdAt),
		children: (b.directBlockIds ?? []).filter((id) => byId.has(id) && !seen.has(id)).map((id) => view(byId.get(id) as Block, new Set([...seen, id]))),
	});
	const folded = new Set(blocks.filter((b) => b.active).flatMap((b) => (b.effectiveMessageIds ?? []).map(base)));
	const messages = entries.filter((e) => e.type === "message" && ROLES.has(e.message?.role ?? ""));
	return {
		blocks: blocks.filter((b) => !nested.has(b.blockId)).map((b) => view(b, new Set([b.blockId]))),
		active: blocks.filter((b) => b.active).length,
		total: blocks.length,
		compressedTokens: blocks.filter((b) => b.active).reduce((sum, b) => sum + Number(b.compressedTokens ?? 0), 0),
		live: messages.filter((e) => !folded.has(String(e.id))).length,
		messages: messages.length,
	};
}

export type Link = { from: string; to: string; kind: "absorbs" | "cites" | "theme"; why: string[] };

/** Distinctive words of a summary: paths, ids and numbers, or words of 6+ letters; message refs (m00012) excluded. */
const termsOf = (text: string) =>
	new Set((text.toLowerCase().match(/[a-zà-ù0-9_./-]+/g) ?? []).map((w) => w.replace(/^[./-]+|[./-]+$/g, "")).filter((w) => !/^m\d{5}$/.test(w) && (w.length >= 6 || (/[./_\d]/.test(w) && w.length >= 3))));

/**
 * Links between blocks for the graph view: "absorbs" (a block compressed an older one), "cites" (a summary names messages,
 * m00012, that sit in another block) and "theme" (rare words shared: 3, or 2 with a path/id/number; kept for the 2 strongest pairs per block).
 * A pair gets one line at most, the first kind found in that order.
 */
export function blockLinks(state: State): Link[] {
	const blocks = state.blocks ?? [];
	const refs = state.messageRefs?.byRaw ?? {};
	const links: Link[] = [];
	const linked = new Set<string>();
	const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
	const add = (from: string, to: string, kind: Link["kind"], why: string[]) => {
		if (from === to || linked.has(pair(from, to))) return;
		linked.add(pair(from, to));
		links.push({ from, to, kind, why });
	};
	const ids = new Set(blocks.map((b) => b.blockId));
	for (const b of blocks) for (const child of b.directBlockIds ?? []) if (ids.has(child)) add(b.blockId, child, "absorbs", []);
	const owner = new Map<string, string>();
	for (const b of blocks) for (const raw of b.directMessageIds ?? []) if (refs[base(raw)]) owner.set(refs[base(raw)], b.blockId);
	for (const b of blocks) {
		const cited = new Map<string, string[]>();
		for (const ref of new Set(b.summary?.match(/\bm\d{5}\b/g) ?? [])) {
			const to = owner.get(ref);
			if (to && to !== b.blockId) cited.set(to, [...(cited.get(to) ?? []), ref]);
		}
		for (const [to, why] of cited) add(b.blockId, to, "cites", why);
	}
	const terms = new Map(blocks.map((b) => [b.blockId, termsOf(`${b.topic ?? ""} ${b.summary ?? ""}`)]));
	const df = new Map<string, number>();
	for (const set of terms.values()) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
	const cap = Math.max(2, Math.ceil(blocks.length * 0.2));
	const scored: { a: string; b: string; score: number; why: string[] }[] = [];
	for (let i = 0; i < blocks.length; i++)
		for (let j = i + 1; j < blocks.length; j++) {
			const [a, b] = [blocks[i].blockId, blocks[j].blockId];
			const shared = [...(terms.get(a) ?? [])].filter((t) => terms.get(b)?.has(t) && (df.get(t) ?? 0) <= cap);
			// Plain words alone are weak (installata, aggiornata): 3 of them, or at least one path/id/number.
			if (shared.length < 2 || (shared.length < 3 && !shared.some((t) => /[./_\d]/.test(t)))) continue;
			const score = shared.reduce((sum, t) => sum + Math.log(blocks.length / (df.get(t) ?? 1)), 0);
			scored.push({ a, b, score, why: shared.sort((x, y) => (df.get(x) ?? 0) - (df.get(y) ?? 0)).slice(0, 4) });
		}
	scored.sort((x, y) => y.score - x.score);
	const kept = new Map<string, number>();
	for (const s of scored) {
		if (linked.has(pair(s.a, s.b)) || ((kept.get(s.a) ?? 0) >= 2 && (kept.get(s.b) ?? 0) >= 2)) continue;
		kept.set(s.a, (kept.get(s.a) ?? 0) + 1);
		kept.set(s.b, (kept.get(s.b) ?? 0) + 1);
		add(s.a, s.b, "theme", s.why);
	}
	return links;
}

function parts(entry: Entry): Part[] {
	const content = entry.message?.content;
	if (typeof content === "string") return [{ kind: entry.message?.role === "toolResult" ? "result" : "text", text: content }];
	if (!Array.isArray(content)) return [];
	const out: Part[] = [];
	for (const block of content as { type?: string; text?: string; thinking?: string; name?: string; arguments?: unknown }[]) {
		if (block?.type === "text" && block.text) out.push({ kind: entry.message?.role === "toolResult" ? "result" : "text", text: block.text });
		else if (block?.type === "thinking" && block.thinking) out.push({ kind: "thinking", text: block.thinking });
		else if (block?.type === "toolCall") out.push({ kind: "tool", text: `${block.name ?? "?"} ${JSON.stringify(block.arguments ?? {})}` });
		else if (block?.type === "image") out.push({ kind: "image", text: "[immagine]" });
	}
	return out;
}

const toMessage = (e: Entry): Message => ({ id: String(e.id), role: e.message?.role ?? "?", label: e.message?.role === "toolResult" ? (e.message.toolName ?? "tool") : (e.message?.role ?? "?"), parts: parts(e) });

/** The original messages a block folded, in session order; `live` gives the messages no active block folds. */
export function blockMessages(state: State, entries: readonly Entry[], blockId: string): Message[] | undefined {
	const blocks = state.blocks ?? [];
	if (blockId === "live") {
		const folded = new Set(blocks.filter((b) => b.active).flatMap((b) => (b.effectiveMessageIds ?? []).map(base)));
		return entries.filter((e) => e.type === "message" && ROLES.has(e.message?.role ?? "") && !folded.has(String(e.id))).map(toMessage);
	}
	const block = blocks.find((b) => b.blockId === blockId);
	if (!block) return undefined;
	const ids = new Set((block.effectiveMessageIds ?? []).map(base));
	return entries.filter((e) => e.type === "message" && ids.has(String(e.id))).map(toMessage);
}

/** Session and sidecar, parsed once per change (keyed by mtime and size of both files). */
const cache = new Map<string, { key: string; entries: Entry[]; state: State }>();
function load(file: string): { entries: Entry[]; state: State } {
	const stamp = (path: string) => {
		try {
			const s = statSync(path);
			return `${s.mtimeMs}:${s.size}`;
		} catch {
			return "-";
		}
	};
	const key = `${stamp(file)}|${stamp(`${file}.acp.json`)}`;
	const hit = cache.get(file);
	if (hit?.key === key) return hit;
	let entries: Entry[] = [];
	let state: State = {};
	try {
		entries = readFileSync(file, "utf8").split("\n").flatMap((line) => {
			try {
				return line ? [JSON.parse(line) as Entry] : [];
			} catch {
				return [];
			}
		});
	} catch {
		/* not written yet */
	}
	try {
		state = JSON.parse(readFileSync(`${file}.acp.json`, "utf8")) as State;
	} catch {
		/* no compression yet */
	}
	cache.clear();
	const value = { key, entries, state };
	cache.set(file, value);
	return value;
}

export async function startServer(sessionFile: () => string | undefined, port = 0): Promise<{ url: string; close: () => Promise<void> }> {
	const token = randomBytes(16).toString("hex");
	const streams = new Set<ServerResponse>();
	const watchers = new Map<ServerResponse, FSWatcher>();
	let graphLib: Buffer | undefined;
	const json = (res: ServerResponse, status: number, body: unknown) => {
		res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
		res.end(JSON.stringify(body));
	};
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const address = server.address();
		const ownPort = typeof address === "object" && address ? address.port : 0;
		if (url.searchParams.get("t") !== token || (req.headers.host !== `127.0.0.1:${ownPort}` && req.headers.host !== `localhost:${ownPort}`)) {
			res.writeHead(403).end("forbidden");
			return;
		}
		const file = sessionFile();
		if (url.pathname === "/") {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'" });
			res.end(PAGE.replace("__TOKEN__", token));
			return;
		}
		if (url.pathname === "/force-graph.js") {
			// Read on first request only: the page may never open the graph tab.
			graphLib ??= readFileSync(new URL("./vendor/force-graph.min.js", import.meta.url));
			res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "max-age=86400" });
			res.end(graphLib);
			return;
		}
		if (url.pathname === "/api/state") {
			if (!file) return json(res, 200, { file: null, blocks: [], active: 0, total: 0, compressedTokens: 0, live: 0, messages: 0 });
			const { entries, state } = load(file);
			return json(res, 200, { file, ...blockTree(state, entries), links: blockLinks(state) });
		}
		const match = /^\/api\/block\/([\w-]+)$/.exec(url.pathname);
		if (match && file) {
			const { entries, state } = load(file);
			const messages = blockMessages(state, entries, match[1]);
			return messages ? json(res, 200, { blockId: match[1], messages }) : json(res, 404, { error: "blocco non trovato" });
		}
		if (url.pathname === "/events") {
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
			res.write(": ok\n\n");
			streams.add(res);
			// Event-driven: a watch on the session's folder, debounced; no polling.
			if (file) {
				let timer: NodeJS.Timeout | undefined;
				const names = new Set([basename(file), `${basename(file)}.acp.json`]);
				try {
					const watcher = watch(dirname(file), (_event, name) => {
						if (name && !names.has(String(name))) return;
						clearTimeout(timer);
						timer = setTimeout(() => res.write("event: change\ndata: {}\n\n"), 150);
					});
					watchers.set(res, watcher);
				} catch {
					/* the page still refreshes by hand */
				}
			}
			req.on("close", () => {
				streams.delete(res);
				watchers.get(res)?.close();
				watchers.delete(res);
			});
			return;
		}
		res.writeHead(404).end("not found");
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}/?t=${token}`;
	return {
		url,
		close: () =>
			new Promise<void>((resolve) => {
				for (const res of streams) res.end();
				for (const watcher of watchers.values()) watcher.close();
				server.closeAllConnections?.();
				server.close(() => resolve());
			}),
	};
}

function openBrowser(url: string) {
	if (process.env.PI_BLOCCHI_NO_OPEN === "1") return;
	// Windows: `explorer <url>` opens File Explorer when the URL has a query string; FileProtocolHandler always uses the default browser.
	const [command, args] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["rundll32", ["url.dll,FileProtocolHandler", url]]
				: ["xdg-open", [url]];
	try {
		execFile(command, args, () => {}).unref();
	} catch {
		/* the URL is shown anyway */
	}
}

/** Side panel line: is billion-context loaded (its `compress` tool exists) and how much it holds in active blocks. */
export function compressionStatus(loaded: boolean, state: State, limit = 100_000, systemTokens = 0): string {
	if (!loaded) return "spento · rilancia install.sh";
	const active = (state.blocks ?? []).filter((b) => b.active);
	const k = (n: number) => `${Math.round(n / 1000)}k`;
	const ctx = `${k(liveTokens(state) + systemTokens)}/${k(limit)}`;
	if (!active.length) return `attivo · ${ctx} · nessun blocco`;
	const tokens = active.reduce((sum, b) => sum + Number(b.compressedTokens ?? 0), 0);
	return `attivo · ${ctx} · ${active.length === 1 ? "1 blocco" : `${active.length} blocchi`} · ${k(tokens)} compressi`;
}

/**
 * Conversation tokens billion-context sees: per-message counts of the last turn (tokenSnapshot, thinking included) for
 * messages no active block covers, plus the block summaries. Its nudges add the system prompt (chars/4) and compare with modelContextLimit.
 */
export function liveTokens(state: State): number {
	const refs = state.messageRefs?.byRaw ?? {};
	const active = (state.blocks ?? []).filter((b) => b.active);
	const covered = new Set(active.flatMap((b) => (b.effectiveMessageIds ?? []).map((id) => refs[id])));
	let tokens = 0;
	for (const [ref, n] of Object.entries(state.tokenSnapshot ?? {})) if (!covered.has(ref)) tokens += n;
	for (const b of active) tokens += Math.ceil((b.summary ?? "").length / 4);
	return tokens;
}

/** modelContextLimit from ~/.pi/acp.json (written by scripts/setup.mjs), 100k when missing. */
function acpLimit(): number {
	try {
		return Number(JSON.parse(readFileSync(join(homedir(), ".pi", "acp.json"), "utf8")).modelContextLimit) || 100_000;
	} catch {
		return 100_000;
	}
}

export default function blocchi(pi: ExtensionAPI) {
	let server: { url: string; close: () => Promise<void> } | undefined;
	let current: ExtensionContext | undefined;
	// Only the small .acp.json is read, at session start and after each agent run (when blocks can change).
	let limit: number | undefined;
	const showStatus = (ctx: ExtensionContext) => {
		const loaded = pi.getAllTools?.().some((tool) => tool.name === "compress") ?? false;
		let state: State = {};
		const file = ctx.sessionManager.getSessionFile?.();
		try {
			if (loaded && file) state = JSON.parse(readFileSync(`${file}.acp.json`, "utf8")) as State;
		} catch {
			/* no blocks yet */
		}
		limit ??= acpLimit();
		const system = (ctx as { getSystemPrompt?: () => unknown }).getSystemPrompt?.();
		ctx.ui.setStatus?.("billion-context", compressionStatus(loaded, state, limit, typeof system === "string" ? Math.ceil(system.length / 4) : 0));
	};
	pi.on("session_start", (_event, ctx) => showStatus(ctx));
	pi.on("agent_end", (_event, ctx) => showStatus(ctx));
	pi.registerCommand("blocchi", {
		description: "Apri nel browser i blocchi della memoria compressa, aggiornati in tempo reale (clic per decomprimere)",
		handler: async (_args, ctx) => {
			current = ctx;
			if (!ctx.sessionManager.getSessionFile?.()) return ctx.ui.notify("Sessione non salvata: non ci sono blocchi da mostrare.", "warning");
			server ??= await startServer(() => current?.sessionManager.getSessionFile?.());
			openBrowser(server.url);
			ctx.ui.notify(`Blocchi della memoria: ${server.url}`, "info");
		},
	});
	pi.on("session_shutdown", async () => {
		const open = server;
		server = undefined;
		current = undefined;
		await open?.close();
	});
}

/** Newest Pi session file, for the standalone command. Re-resolved at most every 2 s. */
function newestSession(root = join(homedir(), ".pi", "agent", "sessions")): string | undefined {
	let best: { path: string; mtime: number } | undefined;
	try {
		for (const dir of readdirSync(root, { withFileTypes: true })) {
			if (!dir.isDirectory()) continue;
			for (const name of readdirSync(join(root, dir.name))) {
				if (!name.endsWith(".jsonl")) continue;
				const path = join(root, dir.name, name);
				const mtime = statSync(path).mtimeMs;
				if (!best || mtime > best.mtime) best = { path, mtime };
			}
		}
	} catch {
		/* no sessions yet */
	}
	return best?.path;
}

if (import.meta.main) {
	const fixed = process.argv[2];
	let found = { at: 0, path: undefined as string | undefined };
	const file = () => {
		if (fixed) return fixed;
		if (Date.now() - found.at > 2000) found = { at: Date.now(), path: newestSession() };
		return found.path;
	};
	const server = await startServer(file, Number(process.env.PI_BLOCCHI_PORT ?? 0));
	console.log(`Blocchi della memoria: ${server.url}\nSessione: ${file() ?? "(nessuna)"}${fixed ? "" : " (segue la più recente)"}\nCtrl+C per chiudere.`);
	openBrowser(server.url);
}

const PAGE = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blocchi della memoria</title>
<style>
:root { --bg:#0d0f1a; --panel:#151827; --line:#262a40; --text:#e6e8f2; --dim:#8b90ab; --accent:#7ee0ff; --pink:#ff7ad9; --green:#7dffa8; --amber:#ffd27a; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
header { position:sticky; top:0; z-index:2; background:rgba(13,15,26,.94); backdrop-filter:blur(6px); border-bottom:1px solid var(--line); padding:14px 24px; display:flex; flex-wrap:wrap; gap:10px 24px; align-items:center; }
h1 { font-size:16px; margin:0; letter-spacing:.02em; }
.stat { color:var(--dim); font-size:13px; } .stat b { color:var(--text); font-weight:600; }
#dot { width:8px; height:8px; border-radius:50%; background:var(--dim); display:inline-block; margin-right:6px; }
#dot.on { background:var(--green); box-shadow:0 0 8px var(--green); }
#file { color:var(--dim); font:12px ui-monospace, Menlo, monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:46ch; }
input { background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:6px 10px; width:240px; margin-left:auto; }
main { max-width:1100px; margin:0 auto; padding:20px 24px 80px; }
.block { border:1px solid var(--line); border-radius:8px; background:var(--panel); margin:10px 0; }
.block.inactive { opacity:.72; }
.children { margin:0 14px 12px 22px; border-left:2px solid var(--line); padding-left:12px; }
.head { display:flex; gap:12px; align-items:baseline; padding:10px 14px; cursor:pointer; user-select:none; }
.head:hover { background:#1b1f33; }
.id { font:600 12px ui-monospace, Menlo, monospace; color:var(--accent); min-width:3.5em; }
.topic { flex:1; }
.meta { color:var(--dim); font-size:12px; white-space:nowrap; }
.badge { font-size:11px; padding:1px 7px; border-radius:10px; border:1px solid var(--line); color:var(--dim); }
.badge.active { color:var(--green); border-color:#2f6b45; }
.body { padding:0 14px 12px; }
.summary { white-space:pre-wrap; color:#cfd3e6; background:#11131f; border:1px solid var(--line); border-radius:6px; padding:10px 12px; font-size:13px; }
button { background:transparent; color:var(--pink); border:1px solid #5a2f52; border-radius:6px; padding:5px 12px; cursor:pointer; margin:10px 0 4px; font-size:13px; }
button:hover { background:#2a1530; }
.msg { border-top:1px solid var(--line); padding:8px 0; }
.role { font:600 11px ui-monospace, Menlo, monospace; text-transform:uppercase; letter-spacing:.06em; }
.role.user { color:var(--amber); } .role.assistant { color:var(--accent); } .role.toolResult { color:var(--green); }
.mid { color:var(--dim); font:11px ui-monospace, Menlo, monospace; margin-left:8px; }
pre { white-space:pre-wrap; word-break:break-word; margin:4px 0; font:12px/1.45 ui-monospace, Menlo, monospace; color:#d8dbea; }
pre.tool { color:var(--pink); } pre.thinking { color:var(--dim); font-style:italic; }
.more { color:var(--accent); cursor:pointer; font-size:12px; }
.empty { color:var(--dim); text-align:center; padding:60px 0; }
.tabs { display:flex; gap:4px; }
.tabs button { margin:0; color:var(--dim); border-color:var(--line); }
.tabs button.on { color:var(--accent); border-color:#2d5d6e; background:#12222b; }
#graphView { display:none; position:fixed; left:0; right:0; bottom:0; top:var(--top, 64px); }
body.graph #graphView { display:flex; } body.graph main { display:none; }
#canvasBox { flex:1; position:relative; overflow:hidden; }
#fg { position:absolute; inset:0; }
#legend { position:absolute; z-index:2; left:14px; bottom:12px; color:var(--dim); font-size:12px; background:rgba(13,15,26,.85); border:1px solid var(--line); border-radius:6px; padding:6px 10px; }
#legend i { display:inline-block; width:22px; height:0; vertical-align:middle; margin:0 6px 0 12px; border-top:2px solid; }
#legend i:first-child { margin-left:0; }
#hits { position:absolute; z-index:2; right:14px; top:10px; color:var(--dim); font-size:12px; }
#side { width:400px; max-width:45vw; border-left:1px solid var(--line); background:var(--panel); overflow:auto; padding:14px 16px; }
#side h2 { font-size:14px; margin:4px 0 8px; }
.link { display:block; color:var(--text); cursor:pointer; padding:3px 0; font-size:13px; }
.link:hover { color:var(--accent); }
.link .kind { color:var(--dim); font-size:12px; margin-right:6px; }
</style>
</head>
<body>
<header>
  <h1><span id="dot"></span>Blocchi della memoria</h1>
  <span class="stat">attivi <b id="sActive">–</b> / <b id="sTotal">–</b></span>
  <span class="stat">compressi <b id="sTok">–</b> token</span>
  <span class="stat">messaggi vivi <b id="sLive">–</b> / <b id="sMsg">–</b></span>
  <span class="stat">aggiornato <b id="sAt">–</b></span>
  <span id="file"></span>
  <span class="tabs"><button id="tabList" class="on">Lista</button><button id="tabGraph">Grafo</button></span>
  <input id="filter" placeholder="Cerca argomento o parola">
</header>
<main id="list"><div class="empty">Caricamento…</div></main>
<div id="graphView">
  <div id="canvasBox">
    <div id="fg"></div>
    <div id="hits"></div>
    <div id="legend"><i style="border-color:#6a70a0"></i>assorbe<i style="border-color:#ff7ad9"></i>cita messaggi di<i style="border-color:#ffd27a;border-top-style:dashed"></i>stesso tema</div>
  </div>
  <div id="side"><div class="meta">Passa sopra un blocco per accendere i suoi vicini, cliccalo per leggerlo e seguire i collegamenti. Trascina blocchi e sfondo, rotella per lo zoom, doppio clic sullo sfondo per rivedere tutto. La ricerca accende i blocchi che contengono la parola.</div></div>
</div>
<script src="/force-graph.js?t=__TOKEN__"></script>
<script>
const T = new URLSearchParams(location.search).get("t");
const api = (p) => fetch(p + (p.includes("?") ? "&" : "?") + "t=" + T).then((r) => r.ok ? r.json() : Promise.reject(r.status));
const open = new Set(), loaded = new Map();
let state = null;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fmt = (n) => n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
const LIMIT = 2000;

function partView(p) {
  const pre = el("pre", p.kind === "tool" ? "tool" : p.kind === "thinking" ? "thinking" : "");
  const text = (p.kind === "tool" ? "→ " : "") + p.text;
  pre.textContent = text.length > LIMIT ? text.slice(0, LIMIT) + "…" : text;
  if (text.length <= LIMIT) return pre;
  const wrap = el("div"); const more = el("span", "more", "mostra tutto (" + fmt(text.length) + " caratteri)");
  more.onclick = () => { pre.textContent = text; more.remove(); };
  wrap.append(pre, more); return wrap;
}
function messagesView(messages) {
  const box = el("div");
  if (!messages.length) box.append(el("div", "meta", "Nessun messaggio trovato nella sessione."));
  for (const m of messages) {
    const row = el("div", "msg"); const top = el("div");
    top.append(el("span", "role " + m.role, m.label), el("span", "mid", m.id));
    row.append(top); for (const p of m.parts) row.append(partView(p)); box.append(row);
  }
  return box;
}
async function decompress(id, slot, button) {
  button.disabled = true; button.textContent = "Decomprimo…";
  try { const r = await api("/api/block/" + id); loaded.set(id, r.messages); slot.replaceChildren(messagesView(r.messages)); button.textContent = "Richiudi i messaggi"; }
  catch { button.textContent = "Errore, riprova"; }
  button.disabled = false;
}
function blockView(b, q) {
  const card = el("div", "block" + (b.active ? "" : " inactive"));
  const head = el("div", "head");
  head.append(el("span", "id", b.blockId), el("span", "topic", b.topic), el("span", "badge" + (b.active ? " active" : ""), b.active ? "attivo" : "assorbito"), el("span", "meta", fmt(b.tokens) + " tok · " + b.messages + " msg · T" + b.tier));
  card.append(head);
  if (open.has(b.blockId)) {
    const body = el("div", "body");
    body.append(el("div", "summary", b.summary || "(senza riassunto)"));
    const slot = el("div"); const button = el("button", "", "Decomprimi: mostra i messaggi originali");
    button.onclick = () => { if (loaded.has(b.blockId)) { loaded.delete(b.blockId); slot.replaceChildren(); button.textContent = "Decomprimi: mostra i messaggi originali"; } else decompress(b.blockId, slot, button); };
    if (loaded.has(b.blockId)) { slot.append(messagesView(loaded.get(b.blockId))); button.textContent = "Richiudi i messaggi"; }
    body.append(button, slot); card.append(body);
  }
  head.onclick = () => { open.has(b.blockId) ? open.delete(b.blockId) : open.add(b.blockId); render(); };
  const kids = b.children.filter((c) => matches(c, q));
  if (kids.length && open.has(b.blockId)) { const box = el("div", "children"); for (const c of kids) box.append(blockView(c, q)); card.append(box); }
  return card;
}
const matches = (b, q) => !q || (b.blockId + " " + b.topic + " " + b.summary).toLowerCase().includes(q) || b.children.some((c) => matches(c, q));
function render() {
  if (graphMode) return renderGraph();
  const list = document.getElementById("list"); const q = document.getElementById("filter").value.trim().toLowerCase();
  if (!state) return;
  const y = scrollY; list.replaceChildren();
  const live = { blockId: "live", topic: "Contesto vivo: messaggi non compressi", summary: "I messaggi che il modello vede ancora per intero.", active: true, tokens: 0, messages: state.live, tier: "–", children: [] };
  const blocks = [...state.blocks].reverse();
  if (!blocks.length) list.append(el("div", "empty", state.file ? "Nessun blocco: la sessione non è ancora stata compressa." : "Nessuna sessione trovata."));
  for (const b of blocks) if (matches(b, q)) list.append(blockView(b, q));
  if (state.file) list.append(blockView(live, ""));
  scrollTo(0, y);
}
async function refresh() {
  try {
    state = await api("/api/state");
    for (const [k, v] of [["sActive", state.active], ["sTotal", state.total], ["sTok", fmt(state.compressedTokens)], ["sLive", state.live], ["sMsg", state.messages], ["sAt", new Date().toLocaleTimeString()]]) document.getElementById(k).textContent = v;
    document.getElementById("file").textContent = state.file || "";
    for (const id of [...loaded.keys()]) api("/api/block/" + id).then((r) => { loaded.set(id, r.messages); render(); }, () => loaded.delete(id));
    render();
  } catch {}
}
document.getElementById("filter").oninput = render;

// ---- graph view: force-graph (vendored, MIT, Vasco Asturiano); it pauses redraw when nothing moves ----
let graphMode = false, selected = null, hovered = null, fg = null, graphKey = "", touched = false;
let look = { q: "", hits: new Set(), focus: null, near: new Set() };
const nodeById = new Map();
const flat = () => { const out = []; const walk = (b) => { out.push(b); b.children.forEach(walk); }; (state?.blocks || []).forEach(walk); return out; };
const radius = (b) => Math.min(12, 3 + Math.sqrt(b.tokens) / 25);
const KIND = { absorbs: "assorbe", cites: "cita messaggi di", theme: "stesso tema di" };
const COLOR = { absorbs: "#6a70a0", cites: "#ff7ad9", theme: "#ffd27a" };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const lit = (id) => look.q ? look.hits.has(id) : !look.focus || id === look.focus || look.near.has(id);
const touches = (l) => look.focus && (l.from === look.focus || l.to === look.focus);
function drawNode(n, ctx, k) {
  const b = n.b, r = radius(b), on = lit(n.id), sel = n.id === selected, hit = look.hits.has(n.id);
  ctx.globalAlpha = on ? 1 : 0.15;
  ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
  ctx.fillStyle = b.active ? "#1d4f63" : "#2a2e48"; ctx.fill();
  ctx.lineWidth = (sel || hit ? 2.5 : 1.2) / Math.sqrt(k);
  ctx.strokeStyle = sel ? "#ffffff" : hit ? "#ff7ad9" : b.active ? "#7ee0ff" : "#5d6390"; ctx.stroke();
  // Labels: heaviest blocks always, the rest on zoom, hover, selection, search or as neighbours of the focus.
  if (on && (n.big || k >= 1.8 || sel || hit || n.id === hovered || (look.focus && look.near.has(n.id)))) {
    const fs = 11 / k, label = b.blockId + " · " + (b.topic.length > 30 ? b.topic.slice(0, 29) + "…" : b.topic);
    ctx.font = fs + "px ui-sans-serif, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.lineWidth = 3 / k; ctx.strokeStyle = "#0d0f1a"; ctx.strokeText(label, n.x, n.y + r + 2 / k);
    ctx.fillStyle = sel || hit || n.id === hovered ? "#e6e8f2" : "#8b90ad"; ctx.fillText(label, n.x, n.y + r + 2 / k);
  }
  ctx.globalAlpha = 1;
}
function ensureGraph() {
  if (fg || typeof ForceGraph === "undefined") return fg;
  // force-graph empties its container: give it its own, under the counter and legend.
  const box = document.getElementById("fg");
  fg = ForceGraph()(box)
    .backgroundColor("#0d0f1a")
    .nodeLabel((n) => esc(n.b.topic) + " (" + fmt(n.b.tokens) + " token)")
    .nodeCanvasObject(drawNode)
    .nodePointerAreaPaint((n, color, ctx) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x, n.y, radius(n.b) + 2, 0, 2 * Math.PI); ctx.fill(); })
    .linkColor((l) => COLOR[l.kind] + (lit(l.from) && lit(l.to) || touches(l) ? (l.kind === "theme" && !touches(l) ? "88" : "ff") : "1c"))
    .linkWidth((l) => touches(l) ? 2.4 : l.kind === "theme" ? 0.7 : 1.3)
    .linkLineDash((l) => l.kind === "theme" ? [3, 4] : null)
    .linkDirectionalArrowLength((l) => l.kind === "cites" ? 5 : 0)
    .linkDirectionalArrowRelPos(1)
    .linkLabel((l) => esc(l.from + " " + KIND[l.kind] + " " + l.to + (l.why.length ? ": " + l.why.join(", ") : "")))
    .onNodeHover((n) => { hovered = n ? n.id : null; box.style.cursor = n ? "pointer" : ""; paint(false); })
    .onNodeClick((n) => select(n.id, false))
    .onBackgroundClick(() => { selected = null; paint(true); })
    .warmupTicks(80) // first frame already close to the final layout
    .cooldownTicks(150)
    .onEngineStop(() => { if (!touched) fg.zoomToFit(400, 50); });
  fg.d3Force("charge").strength(-120);
  fg.d3Force("link").distance((l) => l.kind === "absorbs" ? 35 : l.kind === "cites" ? 60 : 80).strength((l) => l.kind === "theme" ? 0.12 : 0.5);
  // Once the user pans, zooms or drags, the view is theirs: no more automatic fitting.
  for (const ev of ["pointerdown", "wheel"]) box.addEventListener(ev, () => { touched = true; }, { passive: true });
  new ResizeObserver(() => fg.width(box.clientWidth).height(box.clientHeight)).observe(box);
  // Capture phase: stops d3-zoom's double-click zoom so the gesture means "show everything".
  box.addEventListener("dblclick", (e) => { if (!hovered) { e.stopPropagation(); fg.zoomToFit(400, 50); } }, true);
  return fg;
}
function renderGraph() {
  if (!state) return;
  document.documentElement.style.setProperty("--top", document.querySelector("header").offsetHeight + "px");
  if (!ensureGraph()) { document.getElementById("hits").textContent = "Libreria del grafo non caricata."; return; }
  const nodes = flat(), links = (state.links || []).filter((l) => l.from !== l.to);
  const bigTokens = nodes.map((n) => n.tokens).sort((a, b) => b - a)[Math.min(7, nodes.length - 1)] ?? 0;
  const ids = new Set(nodes.map((b) => b.blockId));
  for (const b of nodes) {
    let n = nodeById.get(b.blockId);
    if (!n) {
      // A new block starts next to a block it is linked to, so the layout moves little.
      const l = links.find((x) => (x.from === b.blockId && nodeById.has(x.to)) || (x.to === b.blockId && nodeById.has(x.from)));
      const p = l && nodeById.get(l.from === b.blockId ? l.to : l.from);
      n = { id: b.blockId }; if (p && p.x !== undefined) { n.x = p.x + Math.random() * 20 - 10; n.y = p.y + Math.random() * 20 - 10; }
      nodeById.set(b.blockId, n);
    }
    n.b = b; n.big = b.tokens >= bigTokens;
  }
  for (const id of [...nodeById.keys()]) if (!ids.has(id)) nodeById.delete(id);
  const key = [...ids].join(",") + "|" + links.map((l) => l.from + l.kind + l.to).join(",");
  if (key !== graphKey) {
    graphKey = key;
    const ok = links.filter((l) => ids.has(l.from) && ids.has(l.to));
    fg.graphData({ nodes: nodes.map((b) => nodeById.get(b.blockId)), links: ok.map((l) => ({ source: l.from, target: l.to, from: l.from, to: l.to, kind: l.kind, why: l.why })) });
    // warmupTicks already placed the nodes: fit right away instead of waiting for the engine to cool down.
    if (!touched) setTimeout(() => fg.zoomToFit(0, 50), 30);
  }
  paint(true);
}
/** Recompute highlight (search, hover, selection) and redraw; no layout work. */
function paint(side) {
  if (!state || !fg) return;
  const nodes = flat(), links = state.links || [];
  const q = document.getElementById("filter").value.trim().toLowerCase(), focus = hovered || selected;
  look = {
    q, focus,
    hits: new Set(q ? nodes.filter((b) => (b.blockId + " " + b.topic + " " + b.summary).toLowerCase().includes(q)).map((b) => b.blockId) : []),
    near: new Set(focus ? links.flatMap((l) => l.from === focus ? [l.to] : l.to === focus ? [l.from] : []) : []),
  };
  document.getElementById("hits").textContent = q ? look.hits.size + " blocchi contengono «" + q + "»" : nodes.length + " blocchi · " + links.length + " collegamenti";
  fg.nodeCanvasObject(drawNode); // setting a prop asks force-graph for one redraw
  if (side) renderSide(nodes, links);
}
const HELP = document.getElementById("side").innerHTML;
function renderSide(nodes, links) {
  const side = document.getElementById("side"), b = nodes.find((n) => n.blockId === selected);
  if (!b) { side.innerHTML = HELP; return; }
  side.replaceChildren();
  const head = el("h2"); head.append(el("span", "id", b.blockId + " "), document.createTextNode(b.topic)); side.append(head);
  side.append(el("div", "meta", (b.active ? "attivo" : "assorbito") + " · " + fmt(b.tokens) + " token · " + b.messages + " messaggi"));
  const mine = links.filter((l) => l.from === b.blockId || l.to === b.blockId);
  if (mine.length) {
    const box = el("div"); box.style.margin = "10px 0";
    for (const l of mine) {
      const out = l.from === b.blockId, other = out ? l.to : l.from, o = nodes.find((n) => n.blockId === other);
      const kind = out ? KIND[l.kind] : l.kind === "absorbs" ? "assorbito da" : l.kind === "cites" ? "citato da" : "stesso tema di";
      const row = el("span", "link"); row.append(el("span", "kind", kind), el("span", "id", other + " "), document.createTextNode(o ? o.topic : ""));
      if (l.why.length) row.append(el("span", "meta", " · " + l.why.join(", ")));
      row.onclick = () => select(other, true); box.append(row);
    }
    side.append(box);
  }
  side.append(el("div", "summary", b.summary || "(senza riassunto)"));
  const slot = el("div"), button = el("button", "", loaded.has(b.blockId) ? "Richiudi i messaggi" : "Decomprimi: mostra i messaggi originali");
  if (loaded.has(b.blockId)) slot.append(messagesView(loaded.get(b.blockId)));
  button.onclick = () => { if (loaded.has(b.blockId)) { loaded.delete(b.blockId); paint(true); } else decompress(b.blockId, slot, button); };
  side.append(button, slot);
}
function select(id, center) {
  selected = id;
  const n = nodeById.get(id);
  if (center && fg && n && n.x !== undefined) fg.centerAt(n.x, n.y, 400);
  paint(true);
}
function setMode(graph) {
  graphMode = graph; document.body.classList.toggle("graph", graph);
  document.getElementById("tabGraph").classList.toggle("on", graph); document.getElementById("tabList").classList.toggle("on", !graph);
  render();
}
document.getElementById("tabList").onclick = () => setMode(false);
document.getElementById("tabGraph").onclick = () => setMode(true);
function connect() {
  const es = new EventSource("/events?t=" + T); const dot = document.getElementById("dot");
  es.onopen = () => dot.classList.add("on");
  es.addEventListener("change", refresh);
  es.onerror = () => { dot.classList.remove("on"); es.close(); setTimeout(() => { connect(); refresh(); }, 2000); };
}
refresh(); connect();
</script>
</body>
</html>`;
