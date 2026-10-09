/**
 * Pi as a child process in RPC mode (pi --mode rpc): JSON commands on stdin, responses and session events on stdout,
 * one record per LF (never split on U+2028/U+2029, which are valid inside JSON strings — Node's readline would).
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export class PiRpc extends EventEmitter {
	#child;
	#buffer = "";
	#next = 1;
	#pending = new Map();

	/** @param {{ command?: string, args?: string[], cwd?: string, env?: NodeJS.ProcessEnv }} options args default: --mode rpc */
	constructor(options = {}) {
		super();
		this.options = options;
	}

	start() {
		const { command = "pi", args = ["--mode", "rpc"], cwd, env } = this.options;
		this.#child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });
		this.#child.stdout.setEncoding("utf8");
		this.#child.stdout.on("data", (chunk) => this.#read(chunk));
		this.#child.stderr.setEncoding("utf8");
		this.#child.stderr.on("data", (chunk) => this.emit("stderr", chunk));
		this.#child.on("exit", (code) => {
			for (const waiter of this.#pending.values()) waiter.reject(new Error(`pi è uscito (${code})`));
			this.#pending.clear();
			this.emit("exit", code);
		});
		this.#child.on("error", (error) => this.emit("exit", error.message));
		return this;
	}

	#read(chunk) {
		this.#buffer += chunk;
		let end;
		while ((end = this.#buffer.indexOf("\n")) !== -1) {
			const line = this.#buffer.slice(0, end).replace(/\r$/, "");
			this.#buffer = this.#buffer.slice(end + 1);
			if (!line.trim()) continue;
			let record;
			try {
				record = JSON.parse(line);
			} catch {
				this.emit("stderr", `riga non JSON da pi: ${line.slice(0, 200)}\n`);
				continue;
			}
			if (record.type === "response" && record.id && this.#pending.has(record.id)) {
				const waiter = this.#pending.get(record.id);
				this.#pending.delete(record.id);
				if (record.success) waiter.resolve(record.data);
				else waiter.reject(new Error(record.error ?? `${record.command} non riuscito`));
			} else if (record.type === "extension_ui_request") this.emit("ui", record);
			else this.emit("event", record);
		}
	}

	#write(record) {
		this.#child?.stdin.write(`${JSON.stringify(record)}\n`);
	}

	/** A command; resolves with its response data. */
	send(type, fields = {}) {
		const id = `desk-${this.#next++}`;
		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			this.#write({ id, type, ...fields });
		});
	}

	prompt(message) {
		return this.send("prompt", { message });
	}

	abort() {
		return this.send("abort");
	}

	/** The answer to an extension dialog (confirm, select, input). */
	answer(id, fields) {
		this.#write({ type: "extension_ui_response", id, ...fields });
	}

	/** The Pi process (to recognise this window's session among the running ones). */
	get pid() {
		return this.#child?.pid;
	}

	stop() {
		this.#child?.kill();
	}
}
