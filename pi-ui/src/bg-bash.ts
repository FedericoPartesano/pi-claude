/**
 * Background bash, like Claude Code's send-now (v2.1.281+): when the user sends queued messages now while a shell
 * command runs, the command moves to the background and keeps running, the tool call returns at once (output so far
 * plus a log path) and the model reads the messages in the same turn. When the command ends the model gets a message.
 *
 * The `bash` override reuses Pi's own definition (same prompt snippet and guidelines, so the cached prefix does not
 * change) with an exec wrapper: the process gets its own abort signal, so cutting the tool call loose does not kill it.
 */
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TAIL_CHARS = 1500;

type ExecOptions = { onData: (data: Buffer) => void; signal?: AbortSignal; timeout?: number; env?: NodeJS.ProcessEnv };
type BashOperations = { exec: (command: string, cwd: string, options: ExecOptions) => Promise<{ exitCode: number | null }> };
type ToolResult = { content: { type: "text"; text: string }[]; details?: unknown };
type ToolDef = {
	execute: (id: string, params: { command: string; timeout?: number }, signal: AbortSignal | undefined, onUpdate: ((r: unknown) => void) | undefined, ctx?: unknown) => Promise<ToolResult>;
	[key: string]: unknown;
};

export type Done = { id: string; command: string; log: string; ms: number; outcome: string; tail: string };

/** Running bash calls that can move to the background, by tool call id. */
const running = new Map<string, () => void>();

/** Moves every running bash call to the background. Returns how many moved. */
export function detachAll(): number {
	const all = [...running.values()];
	running.clear();
	for (const detach of all) detach();
	return all.length;
}

export const runningCount = () => running.size;

/** Commands moved to the background and still running, by tool call id (for the "background" row under the chat). */
export type BgTask = { command: string; startedAt: number; log: string };
const tasks = new Map<string, BgTask>();
let onTasks: (() => void) | undefined;
export const backgroundTasks = () => [...tasks.values()];
/** One listener: called when a task starts or ends (no polling, no timer). */
export const watchBackgroundTasks = (cb: (() => void) | undefined) => { onTasks = cb; };
/** Rows for the widget: `HH:MM:SS  command` (start time, so the row never goes stale between redraws). */
export function taskRows(list: BgTask[], max = 3): string[] {
	const row = (t: BgTask) => `${new Date(t.startedAt).toTimeString().slice(0, 8)}  ${t.command.replace(/\s+/g, " ").slice(0, 70)}`;
	const rows = list.slice(0, max).map(row);
	if (list.length > max) rows.push(`+${list.length - max} altri`);
	return rows;
}

/** The message the model gets when a background command ends. */
export function doneMessage(done: Done): string {
	const seconds = Math.round(done.ms / 1000);
	return `Background command «${done.command.replace(/\s+/g, " ").slice(0, 80)}» finished: ${done.outcome}, ${seconds}s. Log: ${done.log}\n${done.tail ? `Last lines:\n${done.tail}` : "(no output)"}`;
}

/** Outcome of a failed inner tool call (abort, timeout, no exit code): Pi's bash throws with the status on the last line. */
export function outcomeOf(error: unknown): string {
	if (!error) return "exit 0";
	const last = (error instanceof Error ? error.message : String(error)).trimEnd().split("\n").pop() ?? "";
	const code = /exited with code (\d+)/.exec(last);
	if (code) return `exit ${code[1]}`;
	if (/timed out/.test(last)) return last.replace(/^Command /, "");
	return last || "failed";
}

const strip = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

/**
 * Wraps a bash tool definition factory. `make(operations)` must build Pi's bash definition with the given exec backend;
 * `local` is Pi's local backend; `notify` reports a finished background command.
 */
export function backgroundBash(make: (operations: BashOperations) => ToolDef, local: BashOperations, notify: (done: Done) => void, dir = join(tmpdir(), `pi-bg-${process.pid}`)) {
	const base = make(local);
	return {
		...base,
		async execute(id: string, params: { command: string; timeout?: number }, signal: AbortSignal | undefined, onUpdate: ((r: unknown) => void) | undefined, ctx?: unknown): Promise<ToolResult> {
			const inner = new AbortController();
			let detached = false;
			let tail = "";
			let fd: number | undefined;
			let exitCode: number | null | undefined;
			const onAbort = () => { if (!detached) inner.abort(); };
			if (signal?.aborted) inner.abort();
			else signal?.addEventListener("abort", onAbort, { once: true });
			const operations: BashOperations = {
				exec: (command, cwd, options) =>
					local.exec(command, cwd, {
						...options,
						signal: inner.signal,
						onData: (data) => {
							tail = (tail + data.toString("utf8")).slice(-TAIL_CHARS * 2);
							if (fd !== undefined) {
								try { writeSync(fd, data); } catch {}
							} else options.onData(data);
						},
					}).then((r) => {
						exitCode = r.exitCode;
						return r;
					}),
			};
			const startedAt = Date.now();
			const run = make(operations).execute(id, params, inner.signal, (r) => { if (!detached) onUpdate?.(r); }, ctx);
			let moveOut!: (r: ToolResult) => void;
			const moved = new Promise<ToolResult>((res) => (moveOut = res));
			running.set(id, () => {
				detached = true;
				signal?.removeEventListener("abort", onAbort);
				mkdirSync(dir, { recursive: true });
				const log = join(dir, `${id.replace(/[^\w-]/g, "_").slice(-40)}.log`);
				try {
					fd = openSync(log, "a");
					writeSync(fd, tail);
				} catch {
					fd = undefined;
				}
				tasks.set(id, { command: params.command, startedAt, log });
				onTasks?.();
				const finish = (error?: unknown) => {
					tasks.delete(id);
					onTasks?.();
					if (fd !== undefined) try { closeSync(fd); } catch {}
					fd = -1; // keep later data out of the (closed) editor stream
					notify({ id, command: params.command, log, ms: Date.now() - startedAt, outcome: typeof exitCode === "number" ? `exit ${exitCode}` : outcomeOf(error), tail: strip(tail).trimEnd().slice(-TAIL_CHARS) });
				};
				run.then(() => finish(), finish);
				const sofar = strip(tail).trimEnd().slice(-TAIL_CHARS);
				moveOut({
					content: [{ type: "text", text: `${sofar ? `${sofar}\n\n` : ""}[The user moved this command to the background to talk to you: it is still running, output goes to ${log}. You get a message when it ends: do not poll or sleep.]` }],
					details: { background: true, log },
				});
			});
			try {
				return await Promise.race([run, moved]);
			} finally {
				running.delete(id);
				if (!detached) signal?.removeEventListener("abort", onAbort);
			}
		},
	};
}
