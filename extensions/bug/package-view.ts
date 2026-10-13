/**
 * Reads a downloaded bug package (the folder writeBundle made) into plain data for the viewer. The package comes from
 * other people's computers: it is only read as text, never run, symlinks are skipped, sizes are capped.
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MAX_FILE = 2 * 1024 * 1024;
const MAX_ITEMS = 1500;

export interface ToolCall {
	name: string;
	args: string;
}

export interface Turn {
	role: "user" | "assistant" | "tool" | "note";
	text: string;
	at?: string;
	tools?: ToolCall[];
	toolName?: string;
}

export interface BugPackage {
	report: unknown;
	todo: unknown;
	crashes: unknown;
	conversation: Turn[];
	/** How many conversation entries were left out (the cap). */
	omitted: number;
	notes: { name: string; text: string }[];
	files: { path: string; size: number }[];
	systemPromptChars: number;
}

function readText(path: string): string | undefined {
	try {
		const info = lstatSync(path);
		if (!info.isFile() || info.size > MAX_FILE) return undefined;
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

function readJson(path: string): unknown {
	const text = readText(path);
	if (text === undefined) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function walk(dir: string, prefix = "", out: { path: string; size: number }[] = []): { path: string; size: number }[] {
	let names: string[] = [];
	try {
		names = readdirSync(dir).sort();
	} catch {
		return out;
	}
	for (const name of names) {
		if (out.length > 400) break;
		const full = join(dir, name);
		const info = lstatSync(full);
		if (info.isSymbolicLink()) continue;
		if (info.isDirectory()) walk(full, `${prefix}${name}/`, out);
		else if (info.isFile()) out.push({ path: `${prefix}${name}`, size: info.size });
	}
	return out;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} caratteri tagliati)` : text);

const textOf = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: string; text: string } => (block as { type?: string })?.type === "text" && typeof (block as { text?: unknown }).text === "string")
		.map((block) => block.text)
		.join("\n");
};

/** The session file as a conversation: who said what, tools called (short), results (clipped), compactions. */
export function conversationOf(jsonl: string): { turns: Turn[]; omitted: number } {
	const turns: Turn[] = [];
	for (const line of jsonl.split("\n")) {
		if (!line.trim()) continue;
		let entry: { type?: string; timestamp?: string; summary?: string; customType?: string; data?: { line?: string }; message?: { role?: string; content?: unknown; toolName?: string } };
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (entry.type === "compaction" && entry.summary) turns.push({ role: "note", text: `Compattazione della sessione:\n${clip(entry.summary, 3000)}`, at: entry.timestamp });
		else if (entry.type === "custom" && entry.customType === "goal-event" && entry.data?.line) turns.push({ role: "note", text: entry.data.line, at: entry.timestamp });
		else if (entry.type === "message" && entry.message) {
			const { role, content, toolName } = entry.message;
			if (role === "user") turns.push({ role: "user", text: clip(textOf(content), 6000), at: entry.timestamp });
			else if (role === "assistant") {
				const tools = Array.isArray(content)
					? (content as { type?: string; name?: string; arguments?: unknown }[]).filter((block) => block?.type === "toolCall").map((block) => ({ name: String(block.name), args: clip(JSON.stringify(block.arguments ?? {}), 400) }))
					: [];
				const text = textOf(content);
				if (text || tools.length) turns.push({ role: "assistant", text: clip(text, 6000), tools, at: entry.timestamp });
			} else if (role === "toolResult") turns.push({ role: "tool", text: clip(textOf(content), 1500), toolName, at: entry.timestamp });
		}
	}
	const omitted = Math.max(0, turns.length - MAX_ITEMS);
	return { turns: omitted ? turns.slice(-MAX_ITEMS) : turns, omitted };
}

export function readPackage(dir: string): BugPackage {
	const conversation = conversationOf(readText(join(dir, "session.jsonl")) ?? "");
	const notes: { name: string; text: string }[] = [];
	for (const file of walk(dir)) {
		if (/^(memory|intents)\//.test(file.path) && /\.(md|jsonl|json|txt)$/.test(file.path)) {
			const text = readText(join(dir, file.path));
			if (text !== undefined) notes.push({ name: file.path, text: clip(text, 8000) });
		}
	}
	return {
		report: readJson(join(dir, "report.json")),
		todo: readJson(join(dir, "todo.json")),
		crashes: readJson(join(dir, "crashes.json")),
		conversation: conversation.turns,
		omitted: conversation.omitted,
		notes,
		files: walk(dir),
		systemPromptChars: (readText(join(dir, "system-prompt.txt")) ?? "").length,
	};
}
