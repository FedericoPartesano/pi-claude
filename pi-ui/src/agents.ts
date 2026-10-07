/**
 * Sub-agents at work, for the session panel: from the `subagent` tool (single, parallel or chain calls, with the
 * agents' own messages in its progress) and from the `team` tool (its progress lines).
 */
import { truncateToWidth } from "@earendil-works/pi-tui";
import { C, fg } from "./palette.ts";
import { phrase } from "./phrases.ts";
import { SPINNER } from "./status-bar.ts";
import { formatDuration } from "./steps.ts";

export interface AgentRow {
	key: string;
	name: string;
	task: string;
	state: "queued" | "running" | "done" | "failed";
	/** What it is doing now, in words ("eseguo i test"). */
	doing?: string;
	startedAt?: number;
	endedAt?: number;
	attempt?: number;
}

interface SubagentResult {
	agent?: string;
	task?: string;
	exitCode?: number;
	stopReason?: string;
	messages?: { role?: string; content?: { type: string; name?: string; arguments?: Record<string, unknown> }[] }[];
}

const lower = (text: string) => text[0].toLowerCase() + text.slice(1);

/** The agent's latest tool call as a phrase, from its streamed messages. */
function lastAction(result: SubagentResult | undefined): string | undefined {
	for (const message of [...(result?.messages ?? [])].reverse()) {
		const call = [...(message.content ?? [])].reverse().find((part) => part.type === "toolCall" && part.name);
		if (call?.name) return lower(phrase(call.name, call.arguments).text);
	}
	return undefined;
}

export function subagentRows(
	args: { agent?: string; task?: string; tasks?: { agent: string; task: string }[]; chain?: { agent: string; task: string }[] },
	partial: { details?: { results?: SubagentResult[] } } | undefined,
	finished: { isError: boolean; at: number } | undefined,
	startedAt: number,
): AgentRow[] {
	const planned = args.chain ?? args.tasks ?? (args.agent ? [{ agent: args.agent, task: args.task ?? "" }] : []);
	const results = partial?.details?.results ?? [];
	const chain = Boolean(args.chain);
	return planned.map((item, index) => {
		const result = results[index];
		// A chain runs one step at a time: steps without a result are still waiting.
		let state: AgentRow["state"] = chain && !result ? "queued" : "running";
		if (finished) state = (result?.exitCode ?? 0) !== 0 || (finished.isError && (!result || results.length - 1 === index)) ? "failed" : "done";
		else if (result && (result.exitCode ?? 0) !== 0) state = "failed";
		else if (chain && index < results.length - 1) state = "done";
		return { key: `${index}`, name: item.agent, task: item.task.replace(/\{previous\}/g, "…").trim(), state, doing: state === "running" ? lastAction(result) : undefined, startedAt: state === "queued" ? undefined : startedAt, endedAt: finished?.at };
	});
}

/** Team progress lines ("▶ t2 scout (haiku) · tentativo 1: title", "✓ t1 verificato", "✗ t2 …") → latest state per task. */
export function teamRows(lines: string[], now: number): AgentRow[] {
	const rows = new Map<string, AgentRow>();
	for (const line of lines) {
		const start = /^▶ (\S+) (\S+) \([^)]*\) · tentativo (\d+)(?: · [^:]*)?: (.*)$/.exec(line);
		if (start) {
			rows.set(start[1], { key: start[1], name: `${start[1]} ${start[2]}`, task: start[4], state: "running", attempt: Number(start[3]), startedAt: rows.get(start[1])?.startedAt ?? now });
			continue;
		}
		const end = /^([✓✗⤼]) (\S+)/.exec(line);
		const row = end ? rows.get(end[2]) : undefined;
		if (row) row.state = end![1] === "✓" ? "done" : "failed";
	}
	return [...rows.values()];
}

/** Per agent: icon, name, time; the task; and what it is doing now, when running. */
export function renderAgents(rows: AgentRow[], width: number, now: number, frame: number): string[] {
	const lines: string[] = [];
	for (const row of rows) {
		const icon = { queued: fg(C.faint, "○"), running: fg(C.cyan, SPINNER[frame % SPINNER.length]), done: fg(C.ok, "✓"), failed: fg(C.err, "✗") }[row.state];
		const time = row.startedAt ? ` · ${formatDuration(Math.max(0, (row.endedAt ?? now) - row.startedAt)).replace(/,\d(?=s$)/, "")}` : "";
		const attempt = row.attempt && row.attempt > 1 ? ` · tentativo ${row.attempt}` : "";
		lines.push(truncateToWidth(`${icon} ${fg(row.state === "queued" ? C.dim : C.text, row.name)}${fg(C.dim, `${time}${attempt}`)}`, width));
		if (row.task) lines.push(truncateToWidth(`  ${fg(C.dim, row.task)}`, width));
		if (row.doing) lines.push(truncateToWidth(`  ${fg(C.cyan, `▸ ${row.doing}`)}`, width));
	}
	return lines;
}
