/**
 * `lancia`: run a long command in the background and get told when it ends, instead of `sleep N; tail log` polling.
 * The tool returns at once with the log path; when the process exits the extension sends the model a message (exit
 * code, duration, last lines) that wakes it if it is idle. Off by default (extra tool = fixed prompt cost, and turning
 * it on mid-session rewrites the cached prefix): PI_JOBS=1 turns it on at start, `/jobs on` during a session.
 * The timeout bar shows each job (log tail included) through the `timeout-bar:set` event. Needs bash (Linux, macOS, WSL).
 */
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface Job {
	id: string;
	name: string;
	command: string;
	pid: number;
	log: string;
	startedAt: number;
	kill(): void;
}

const DEFAULT_TIMEOUT_S = 3600;
const TAIL_CHARS = 1500;

/** Last lines of a log, at most `chars` characters, ANSI stripped. */
export function logTail(file: string, chars = TAIL_CHARS, lines = 20): string {
	try {
		const size = statSync(file).size;
		const fd = openSync(file, "r");
		try {
			const bytes = Math.min(size, 16_000);
			const buffer = Buffer.alloc(bytes);
			readSync(fd, buffer, 0, bytes, size - bytes);
			const text = buffer.toString("utf8").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trimEnd();
			return text.split(/\r?\n/).slice(-lines).join("\n").slice(-chars);
		} finally {
			closeSync(fd);
		}
	} catch {
		return "";
	}
}

/** The message the model receives when a job ends. */
export function doneMessage(job: Pick<Job, "id" | "name" | "log">, code: number | null, signal: string | null, ms: number, timedOut: boolean): string {
	const seconds = Math.round(ms / 1000);
	const how = timedOut ? `killed after the ${seconds}s timeout` : signal ? `stopped by ${signal}` : `exit ${code}`;
	const tail = logTail(job.log);
	return `Job ${job.id} «${job.name}» finished: ${how}, ${seconds}s. Log: ${job.log}\n${tail ? `Last lines:\n${tail}` : "(no output)"}`;
}

export default function jobs(pi: ExtensionAPI) {
	if (process.platform === "win32") return;
	const running = new Map<string, Job>();
	const dir = join(tmpdir(), `pi-jobs-${process.pid}`);
	let counter = 0;
	let registered = false;

	const start = (command: string, name: string | undefined, cwd: string, timeoutS: number): Job => {
		mkdirSync(dir, { recursive: true });
		const id = `j${++counter}`;
		const log = join(dir, `${id}.log`);
		const out = openSync(log, "a");
		const child = spawn("bash", ["-c", command], { cwd, detached: true, stdio: ["ignore", out, out] });
		closeSync(out);
		const startedAt = Date.now();
		const job: Job = {
			id,
			name: name?.trim() || command.replace(/\s+/g, " ").slice(0, 40),
			command,
			pid: child.pid ?? 0,
			log,
			startedAt,
			kill: () => {
				try {
					process.kill(-job.pid, "SIGTERM");
				} catch {
					try {
						child.kill("SIGTERM");
					} catch {}
				}
			},
		};
		running.set(id, job);
		const key = `job:${id}`;
		pi.events?.emit("timeout-bar:set", { key, label: `${id} ${job.name}`, startedAt, timeoutMs: timeoutS * 1000, watch: log });
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			job.kill();
		}, timeoutS * 1000);
		timer.unref?.();
		const finish = (code: number | null, signal: string | null) => {
			clearTimeout(timer);
			if (!running.delete(id)) return;
			try {
				pi.events?.emit("timeout-bar:clear", { key });
				pi.sendMessage(
					{ customType: "job-done", content: doneMessage(job, code, signal, Date.now() - startedAt, timedOut), display: true, details: { id, name: job.name, code, signal, log } },
					{ triggerTurn: true, deliverAs: "followUp" },
				);
			} catch {
				// the extension instance was replaced (reload): nobody to tell
			}
		};
		child.on("exit", (code, signal) => finish(code, signal));
		child.on("error", () => finish(127, null));
		child.unref();
		return job;
	};

	const register = () => {
		if (registered) return;
		registered = true;
		pi.registerTool({
			name: "lancia",
			label: "Lancia",
			description: "Run a long shell command in the background and return at once. You are told when it ends (exit code, last log lines): do not sleep or poll; end your turn or do other work.",
			parameters: {
				type: "object",
				properties: {
					command: { type: "string", description: "Shell command (bash)" },
					name: { type: "string", description: "Short label" },
					timeout: { type: "number", description: `Seconds before it is killed (default ${DEFAULT_TIMEOUT_S})` },
				},
				required: ["command"],
			} as never,
			async execute(_id, params, _signal, _update, ctx) {
				const { command, name, timeout } = params as { command: string; name?: string; timeout?: number };
				const job = start(command, name, ctx.cwd, Number.isFinite(timeout) && (timeout ?? 0) > 0 ? Math.min(Number(timeout), 86_400) : DEFAULT_TIMEOUT_S);
				return { content: [{ type: "text" as const, text: `Started ${job.id} «${job.name}» (pid ${job.pid}). Log: ${job.log}. You will get a message when it finishes.` }], details: undefined };
			},
		});
	};
	const turnOn = () => {
		register();
		const active = pi.getActiveTools();
		if (!active.includes("lancia")) pi.setActiveTools([...active, "lancia"]);
	};

	pi.on("session_start", () => {
		if (process.env.PI_JOBS === "1") turnOn();
	});

	pi.registerCommand("jobs", {
		description: "Background jobs of `lancia`: /jobs (list), /jobs on, /jobs kill <id>",
		handler: async (args, ctx) => {
			const [word, id] = String(args ?? "").trim().split(/\s+/);
			if (word === "on") {
				turnOn();
				return ctx.ui.notify("Tool lancia acceso: i comandi lunghi partono in background e il modello viene avvisato alla fine.", "info");
			}
			if (word === "kill") {
				const job = running.get(id ?? "");
				if (!job) return ctx.ui.notify(`Nessun job ${id ?? ""} in corso.`, "warning");
				job.kill();
				return ctx.ui.notify(`Job ${job.id} fermato.`, "info");
			}
			if (!running.size) return ctx.ui.notify(registered ? "Nessun job in corso." : "Nessun job in corso (tool lancia spento: /jobs on).", "info");
			ctx.ui.notify([...running.values()].map((job) => `${job.id} «${job.name}» pid ${job.pid} · ${Math.round((Date.now() - job.startedAt) / 1000)}s · ${job.log}`).join("\n"), "info");
		},
	});

	pi.on("session_shutdown", () => {
		for (const job of running.values()) job.kill();
		running.clear();
	});
}
