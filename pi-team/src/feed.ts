/**
 * Live activity of every agent of a team or `parallel` run, built from the JSON events of each child `pi`:
 * thinking, text, tool calls and their results, tokens. Kept out of the chat; the `/agents` view reads it.
 * Bounded: each agent keeps its last entries, each entry its last characters.
 */

export type FeedEntryKind = "thinking" | "text" | "tool" | "result" | "error";

export interface FeedEntry {
	kind: FeedEntryKind;
	text: string;
	/** Tool name, for "tool" and "result" entries. */
	tool?: string;
	failed?: boolean;
}

export interface AgentActivity {
	key: string;
	/** Task id (t1, p2) or a phase: "correzione", "revisione". */
	id: string;
	title: string;
	role: string;
	model: string;
	attempt: number;
	state: "running" | "done" | "failed";
	startedAt: number;
	seconds?: number;
	inputTokens: number;
	outputTokens: number;
	requests: number;
	/** Tool running now, with a short form of its arguments. */
	currentTool?: string;
	/** When the current tool started. */
	toolSince?: number;
	entries: FeedEntry[];
	error?: string;
	/** Tool calls by name, over the whole run (entries keep only the tail). */
	toolCounts: Record<string, number>;
	/** Input tokens of each request, in order: how the context grows. */
	requestTokens: number[];
	/** Last event time: which agent is active now. */
	lastActivity: number;
}

export const MAX_ENTRIES = 120;
export const MAX_ENTRY_CHARS = 1500;

/** One line of a tool's arguments: the command, path or pattern when there is one. */
export function describeArgs(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const record = args as Record<string, unknown>;
	const main = record.command ?? record.path ?? record.pattern ?? record.query ?? record.url;
	const text = typeof main === "string" ? main : JSON.stringify(args);
	return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

function resultText(result: unknown): string {
	const content = (result as { content?: Array<{ type: string; text?: string }> } | undefined)?.content ?? [];
	return content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim();
}

export class AgentFeed {
	readonly agents: AgentActivity[] = [];
	private listeners = new Set<() => void>();
	/** Content block being streamed per agent: deltas append to it until the block ends. */
	private streaming = new Map<string, Map<number, FeedEntry>>();

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private changed() {
		for (const listener of this.listeners) listener();
	}

	/** A new run (team or parallel) starts: forget the previous one. */
	reset() {
		this.agents.length = 0;
		this.streaming.clear();
		this.changed();
	}

	begin(activity: Pick<AgentActivity, "key" | "id" | "title" | "role" | "model" | "attempt"> & { startedAt?: number }) {
		const startedAt = activity.startedAt ?? Date.now();
		this.agents.push({ ...activity, state: "running", startedAt, inputTokens: 0, outputTokens: 0, requests: 0, entries: [], toolCounts: {}, requestTokens: [], lastActivity: startedAt });
		this.changed();
	}

	get(key: string): AgentActivity | undefined {
		return this.agents.find((agent) => agent.key === key);
	}

	private push(agent: AgentActivity, entry: FeedEntry): FeedEntry {
		entry.text = entry.text.slice(-MAX_ENTRY_CHARS);
		agent.entries.push(entry);
		if (agent.entries.length > MAX_ENTRIES) agent.entries.splice(0, agent.entries.length - MAX_ENTRIES);
		return entry;
	}

	/** Applies one JSON event of the agent's `pi --mode json` stream. Unknown events are ignored. */
	event(key: string, event: any) {
		const agent = this.get(key);
		if (!agent || !event || typeof event !== "object") return;
		agent.lastActivity = Date.now();
		const blocks = this.streaming.get(key) ?? new Map<number, FeedEntry>();
		this.streaming.set(key, blocks);
		if (event.type === "message_update") {
			const update = event.assistantMessageEvent ?? {};
			const kind: FeedEntryKind | undefined = update.type?.startsWith("thinking_") ? "thinking" : update.type?.startsWith("text_") ? "text" : undefined;
			if (!kind) return;
			if (update.type.endsWith("_start")) blocks.set(update.contentIndex, this.push(agent, { kind, text: "" }));
			else if (update.type.endsWith("_delta")) {
				const entry = blocks.get(update.contentIndex) ?? this.push(agent, { kind, text: "" });
				blocks.set(update.contentIndex, entry);
				entry.text = (entry.text + (update.delta ?? "")).slice(-MAX_ENTRY_CHARS);
			} else if (update.type.endsWith("_end")) {
				const entry = blocks.get(update.contentIndex);
				const final = update.content ?? update.thinking ?? update.text;
				if (entry && typeof final === "string") entry.text = final.slice(-MAX_ENTRY_CHARS);
				blocks.delete(update.contentIndex);
			}
		} else if (event.type === "message_end" && event.message?.role === "assistant") {
			const message = event.message;
			agent.requests++;
			const input = (message.usage?.input ?? 0) + (message.usage?.cacheRead ?? 0) + (message.usage?.cacheWrite ?? 0);
			agent.requestTokens.push(input);
			agent.inputTokens += input;
			agent.outputTokens += message.usage?.output ?? 0;
			if (message.errorMessage) this.push(agent, { kind: "error", text: message.errorMessage });
			blocks.clear();
		} else if (event.type === "tool_execution_start") {
			const args = describeArgs(event.args);
			agent.currentTool = `${event.toolName}${args ? ` ${args}` : ""}`;
			agent.toolSince = Date.now();
			agent.toolCounts[event.toolName] = (agent.toolCounts[event.toolName] ?? 0) + 1;
			this.push(agent, { kind: "tool", tool: event.toolName, text: args });
		} else if (event.type === "tool_execution_end") {
			agent.currentTool = undefined;
			const text = resultText(event.result);
			this.push(agent, { kind: "result", tool: event.toolName, text: text || (event.isError ? "errore" : "ok"), failed: Boolean(event.isError) });
		} else return;
		this.changed();
	}

	end(key: string, run: { ok: boolean; seconds: number; inputTokens: number; outputTokens: number; error?: string }) {
		const agent = this.get(key);
		if (!agent) return;
		Object.assign(agent, { state: run.ok ? "done" : "failed", seconds: run.seconds, inputTokens: run.inputTokens, outputTokens: run.outputTokens, error: run.error, currentTool: undefined });
		this.streaming.delete(key);
		this.changed();
	}

	get running(): number {
		return this.agents.filter((agent) => agent.state === "running").length;
	}
}
