// Sub-agents for the session panel: rows from the `subagent` tool (single, parallel, chain; progress carries each agent's messages)
// and from the `team` tool (progress text lines). Pure functions, no dependencies; the chat only keeps the calls and draws the rows.
// Same logic as pi-ui/src/agents.ts (which imports pi-tui and cannot be used here).

const lower = (t) => (t ? t[0].toLowerCase() + t.slice(1) : t);
const VERB = { read: "legge", grep: "cerca", glob: "cerca", find: "cerca", ls: "elenca", edit: "modifica", write: "scrive", bash: "esegue", web_search: "cerca sul web", fetch_content: "apre pagina" };

/** The agent's latest tool call as a short phrase, from its streamed messages. */
function lastAction(result) {
	for (const m of [...(result?.messages ?? [])].reverse()) {
		const call = [...(m.content ?? [])].reverse().find((p) => p.type === "toolCall" && p.name);
		if (call) {
			const a = call.arguments ?? {};
			const arg = String(a.path ?? a.file_path ?? a.command ?? a.pattern ?? a.query ?? "").replace(/\s+/g, " ").trim();
			return lower(`${VERB[call.name] ?? call.name}${arg ? ` ${arg}` : ""}`);
		}
	}
	return undefined;
}

/** Rows {name, task, state: queued|running|done|failed, doing, startedAt, endedAt, attempt} of one `subagent` call. */
export function subagentRows(args = {}, partial, finished, startedAt) {
	const planned = args.chain ?? args.tasks ?? (args.agent ? [{ agent: args.agent, task: args.task ?? "" }] : []);
	const results = partial?.details?.results ?? [];
	const chain = Boolean(args.chain);
	return planned.map((item, i) => {
		const r = results[i];
		let state = chain && !r ? "queued" : "running";
		if (finished) state = (r?.exitCode ?? 0) !== 0 || (finished.isError && (!r || results.length - 1 === i)) ? "failed" : "done";
		else if (r && (r.exitCode ?? 0) !== 0) state = "failed";
		else if (chain && i < results.length - 1) state = "done";
		return { name: item.agent, task: String(item.task ?? "").replace(/\{previous\}/g, "…").trim(), state, doing: state === "running" ? lastAction(r) : undefined, startedAt: state === "queued" ? undefined : startedAt, endedAt: finished?.at };
	});
}

/** Rows of one `team` call from its progress lines ("▶ id role (…) · tentativo N: task", "✓|✗|⤼ id"). */
export function teamRows(text, now) {
	const rows = new Map();
	for (const line of String(text ?? "").split("\n")) {
		const s = /^▶ (\S+) (\S+) \([^)]*\) · tentativo (\d+)(?: · [^:]*)?: (.*)$/.exec(line);
		if (s) { rows.set(s[1], { name: `${s[1]} ${s[2]}`, task: s[4], state: "running", attempt: Number(s[3]), startedAt: rows.get(s[1])?.startedAt ?? now }); continue; }
		const e = /^([✓✗⤼]) (\S+)/.exec(line);
		const row = e ? rows.get(e[2]) : undefined;
		if (row) row.state = e[1] === "✓" ? "done" : "failed";
	}
	return [...rows.values()];
}

/** Rows of every call that is running, or finished less than `keepMs` ago. calls: Map id → {tool, args, text, partial, finished, startedAt}. */
export function activeRows(calls, now, keepMs = 20000) {
	const rows = [];
	for (const c of calls.values()) {
		if (c.finished && now - c.finished.at > keepMs) continue;
		rows.push(...(c.tool === "team" ? teamRows(c.text, c.startedAt).map((r) => (c.finished && r.state === "running" ? { ...r, state: c.finished.isError ? "failed" : "done", endedAt: c.finished.at } : r)) : subagentRows(c.args, c.partial, c.finished, c.startedAt)));
	}
	return rows;
}

const dur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}`; };

/** Panel lines; `fit(text, w)` cuts to the width, `S` is the panel palette. Empty when there is nothing to show. */
export function agentLines(rows, w, now, S, fit) {
	const R = "\x1b[0m", out = [];
	for (const r of rows) {
		const icon = { queued: `${S.faint}○`, running: `${S.cyan}◐`, done: `${S.ok}✓`, failed: `${S.err}✗` }[r.state];
		const time = r.startedAt ? ` · ${dur((r.endedAt ?? now) - r.startedAt)}` : "";
		out.push(fit(`${icon}${R} ${r.state === "queued" ? S.dim : S.text}${r.name}${S.dim}${time}${r.attempt > 1 ? ` · tentativo ${r.attempt}` : ""}${R}`, w));
		if (r.task) out.push(fit(`  ${S.dim}${r.task}${R}`, w));
		if (r.doing) out.push(fit(`  ${S.cyan}▸ ${r.doing}${R}`, w));
	}
	return out;
}
