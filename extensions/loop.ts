/**
 * /loop — repeat a prompt on an interval, or at a pace the model chooses.
 *
 *   /loop 5m <prompt>                     every 5 minutes (s/m/h, minimum 1m), first run now
 *   /loop <prompt>                        self-paced: the model calls loop_next(delaySeconds) to schedule the next run
 *   /loop 10m --when "npm test" <prompt>  runs the command first; the model is called only when it fails, and then
 *                                         diagnoses read-only and writes an intent (stage 6 of the AI-native SDLC)
 *   /loop --for 8h ...                    expiry (default 24h) · /loop = status · /loop stop
 *
 * Zero fixed cost: loop_next is registered but inactive until a self-paced loop starts, nothing goes into the system
 * prompt, and no timer exists while no loop is running. Interactive mode only: print/json runs exit right away.
 * PI_LOOP_MIN_SECONDS lowers the 60 s minimum (tests).
 */
import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readUsage, type SubscriptionUsage } from "../pi-team/src/budget.ts";
import { INTENTS_DIR, intentTemplate } from "./intent.ts";

const HOUR = 3600;
const DEFAULT_FOR_SECONDS = 24 * HOUR;
const WHEN_TIMEOUT_MS = 5 * 60_000;
const UNITS: Record<string, number> = { s: 1, m: 60, h: HOUR };

export type LoopArgs =
	| { kind: "status" }
	| { kind: "stop" }
	| { kind: "error"; message: string }
	| { kind: "start"; intervalSeconds: number | undefined; when: string | undefined; forSeconds: number; prompt: string };

export interface LoopState {
	prompt: string;
	/** undefined = self-paced. */
	intervalSeconds: number | undefined;
	when?: string;
	forSeconds: number;
	startedAt: number;
	iteration: number;
	nextRunAt: number;
	/** A run is waiting for Pi to become idle. */
	pending: boolean;
	lastOkAt?: number;
	/** Signature of the last failure handed to the model: the same failure again is not re-sent. */
	lastFailure?: string;
}

export type TickDecision = { action: "run" } | { action: "wait" } | { action: "skip" } | { action: "stop"; reason: string };

function parseDuration(token: string): number | undefined {
	const match = /^(\d+)([smh])$/.exec(token);
	return match ? Number(match[1]) * UNITS[match[2]] : undefined;
}

/** Splits on spaces, keeping "double" or 'single' quoted parts together. Returns undefined on an unbalanced quote. */
function tokenize(text: string): string[] | undefined {
	const tokens: string[] = [];
	const pattern = /\s*(?:"([^"]*)"|'([^']*)'|(["'])|(\S+))/g;
	for (const match of text.matchAll(pattern)) {
		if (match[3]) return undefined;
		tokens.push(match[1] ?? match[2] ?? match[4]);
	}
	return tokens;
}

export function parseLoopArgs(args: string, minSeconds: number): LoopArgs {
	const text = args.trim();
	if (text === "") return { kind: "status" };
	if (text === "stop") return { kind: "stop" };
	const tokens = tokenize(text);
	if (!tokens) return { kind: "error", message: "virgolette non chiuse" };

	let intervalSeconds: number | undefined;
	let when: string | undefined;
	let forSeconds = DEFAULT_FOR_SECONDS;
	let index = 0;
	const first = parseDuration(tokens[0]);
	if (first !== undefined) {
		if (first < minSeconds) return { kind: "error", message: `intervallo minimo ${minSeconds}s` };
		intervalSeconds = first;
		index = 1;
	}
	while (tokens[index]?.startsWith("--")) {
		const flag = tokens[index];
		const value = tokens[index + 1];
		if (value === undefined) return { kind: "error", message: `${flag} senza valore` };
		if (flag === "--when") when = value;
		else if (flag === "--for") {
			const seconds = parseDuration(value);
			if (seconds === undefined) return { kind: "error", message: `durata non valida: ${value} (es. 8h, 30m)` };
			forSeconds = seconds;
		} else return { kind: "error", message: `opzione sconosciuta: ${flag}` };
		index += 2;
	}
	const prompt = tokens.slice(index).join(" ");
	if (prompt === "") return { kind: "error", message: "manca il prompt da ripetere" };
	if (when !== undefined && intervalSeconds === undefined) return { kind: "error", message: "--when richiede un intervallo (es. /loop 10m --when \"npm test\" ...)" };
	return { kind: "start", intervalSeconds, when, forSeconds, prompt };
}

/** Next run on the fixed cadence; when late, run now instead of bursting to catch up. */
export function nextRunAt(lastStart: number, intervalSeconds: number, now: number): number {
	return Math.max(lastStart + intervalSeconds * 1000, now);
}

export function clampDelay(seconds: number, min = 60, max = 3600): number {
	if (!Number.isFinite(seconds)) return min;
	return Math.min(max, Math.max(min, Math.round(seconds)));
}

/** Why the subscription forbids another run, if it does: overage or 5h window at 90% or more. */
export function budgetBlock(usage: SubscriptionUsage | undefined): string | undefined {
	if (!usage) return undefined;
	if (usage.isUsingOverage) return "l'abbonamento sta usando extra usage";
	if (usage.fiveHourUtilization !== undefined && usage.fiveHourUtilization >= 0.9) return `finestra 5h al ${Math.round(usage.fiveHourUtilization * 100)}%`;
	return undefined;
}

export function decideTick(state: LoopState, now: number, env: { busy: boolean; budget?: string }): TickDecision {
	if (now - state.startedAt >= state.forSeconds * 1000) return { action: "stop", reason: `scaduto dopo ${formatDuration(state.forSeconds)}` };
	if (env.budget) return { action: "stop", reason: env.budget };
	if (env.busy) return state.pending ? { action: "skip" } : { action: "wait" };
	return { action: "run" };
}

export function tailOutput(output: string, maxLines = 40, maxChars = 3000): string {
	const lines = output.trimEnd().split("\n");
	let tail = lines.slice(-maxLines).join("\n");
	if (tail.length > maxChars) tail = tail.slice(-maxChars);
	return tail.length < output.trimEnd().length ? `…\n${tail}` : tail;
}

/** Identity of a --when failure: exit code + output with timings and clock times masked. */
export function failureSignature(exitCode: number | null, output: string): string {
	const normalized = output.replace(/\d{1,2}:\d{2}:\d{2}/g, "#").replace(/\d+\.\d+/g, "#");
	return `${exitCode}\n${normalized.trim()}`;
}

export function renderTickMessage(options: {
	prompt: string;
	iteration: number;
	selfPaced: boolean;
	date: string;
	when?: { command: string; exitCode: number | null; output: string };
}): string {
	const lines = [`[loop ${options.iteration}] ${options.prompt}`];
	if (options.when) {
		const { command, exitCode, output } = options.when;
		lines.push(
			"",
			`Il controllo \`${command}\` è fallito (exit ${exitCode ?? "timeout"}). Coda dell'output:`,
			"```",
			tailOutput(output),
			"```",
			"",
			"Regole per questo giro (monitoraggio, non correzione):",
			"- Diagnosi in sola lettura: leggi codice e log, puoi eseguire comandi che non modificano nulla.",
			"- Non modificare il codice né la configurazione: decide l'utente.",
			`- Scrivi la diagnosi come intent in ${INTENTS_DIR}/${options.date}-<slug>.md con il formato sotto, ma con status: draft e source: loop nel frontmatter.`,
			`- Se in ${INTENTS_DIR}/ esiste già un intent con status: draft e source: loop sullo stesso problema, aggiornalo invece di crearne uno nuovo.`,
			"- Alla fine rispondi con 2 righe: problema trovato e percorso dell'intent.",
			"",
			intentTemplate("<titolo del problema>", options.date).replace("source: user", "source: loop"),
		);
	}
	if (options.selfPaced) {
		lines.push(
			"",
			"Questo è un loop a ritmo libero: alla fine del giro, se il loop deve continuare chiama il tool loop_next con il ritardo in secondi (60-3600) e il motivo. Se il lavoro del loop è concluso, non chiamarlo: il loop finisce.",
		);
	}
	return lines.join("\n");
}

function formatDuration(seconds: number): string {
	if (seconds % HOUR === 0) return `${seconds / HOUR}h`;
	if (seconds % 60 === 0) return `${seconds / 60}m`;
	return `${seconds}s`;
}

function clock(time: number): string {
	const date = new Date(time);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function renderLoopStatus(state: LoopState): string {
	const parts = [`loop ${state.intervalSeconds === undefined ? "auto" : formatDuration(state.intervalSeconds)}`, `giro ${state.iteration}`];
	if (state.lastOkAt !== undefined) parts.push(`ok ${clock(state.lastOkAt)}`);
	parts.push(state.pending ? "in attesa che Pi sia libero" : `prossimo ${clock(state.nextRunAt)}`);
	return parts.join(" · ");
}

function runCommand(command: string, cwd: string): Promise<{ exitCode: number | null; output: string }> {
	return new Promise((resolve) => {
		const child = spawn("bash", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		const append = (chunk: Buffer) => {
			output = (output + chunk.toString()).slice(-20_000);
		};
		child.stdout.on("data", append);
		child.stderr.on("data", append);
		const timer = setTimeout(() => child.kill("SIGKILL"), WHEN_TIMEOUT_MS);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ exitCode: code, output });
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ exitCode: null, output: String(error) });
		});
	});
}

export default function (pi: ExtensionAPI) {
	const minSeconds = Number(process.env.PI_LOOP_MIN_SECONDS) > 0 ? Number(process.env.PI_LOOP_MIN_SECONDS) : 60;
	let state: LoopState | undefined;
	let context: ExtensionContext | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	// A tick message was sent and its agent run has not settled yet.
	let tickInFlight = false;
	// Self-paced: delay chosen by the model during the current run.
	let requestedDelay: number | undefined;
	let checking = false;

	const setStatus = (text: string | undefined) => {
		try {
			context?.ui.setStatus("loop", text);
		} catch {
			// Stale context (session replaced).
		}
	};
	const notify = (text: string, level: "info" | "warning" = "info") => {
		try {
			context?.ui.notify(text, level);
		} catch {
			// Stale context.
		}
	};
	const setLoopNextActive = (active: boolean) => {
		const tools = pi.getActiveTools().filter((name) => name !== "loop_next");
		pi.setActiveTools(active ? [...tools, "loop_next"] : tools);
	};

	const stop = (reason: string) => {
		if (!state) return;
		if (timer) clearTimeout(timer);
		timer = undefined;
		if (state.intervalSeconds === undefined) setLoopNextActive(false);
		state = undefined;
		tickInFlight = false;
		requestedDelay = undefined;
		setStatus(undefined);
		notify(`Loop fermato: ${reason}.`);
	};

	const schedule = (at: number) => {
		if (!state) return;
		if (timer) clearTimeout(timer);
		state.nextRunAt = at;
		timer = setTimeout(() => void tick(), Math.max(0, at - Date.now()));
		setStatus(renderLoopStatus(state));
	};

	const tick = async () => {
		timer = undefined;
		if (!state || !context || checking) return;
		const busy = !context.isIdle() || tickInFlight;
		const decision = decideTick(state, Date.now(), { busy, budget: budgetBlock(readUsage()) });
		if (decision.action === "stop") return stop(decision.reason);
		if (decision.action !== "run") {
			// Waiting for agent_settled; at most one run waits.
			state.pending = true;
			setStatus(renderLoopStatus(state));
			return;
		}
		state.pending = false;
		const startedAt = Date.now();
		const loop = state;

		let when: { command: string; exitCode: number | null; output: string } | undefined;
		if (loop.when) {
			checking = true;
			setStatus(`loop ${formatDuration(loop.intervalSeconds ?? 0)} · controllo in corso`);
			const result = await runCommand(loop.when, context.cwd);
			checking = false;
			if (state !== loop) return; // stopped while checking
			if (result.exitCode === 0) {
				loop.lastOkAt = Date.now();
				loop.lastFailure = undefined;
				return schedule(nextRunAt(startedAt, loop.intervalSeconds!, Date.now()));
			}
			// Same failure already diagnosed: no model call until the output changes or the check passes.
			const signature = failureSignature(result.exitCode, result.output);
			if (signature === loop.lastFailure) {
				schedule(nextRunAt(startedAt, loop.intervalSeconds!, Date.now()));
				return setStatus(`${renderLoopStatus(loop)} · errore già segnalato`);
			}
			when = { command: loop.when, ...result };
			if (!context.isIdle()) {
				// The user started working while the check ran: retry once Pi is free.
				loop.pending = true;
				setStatus(renderLoopStatus(loop));
				return;
			}
		}

		loop.iteration += 1;
		if (when) loop.lastFailure = failureSignature(when.exitCode, when.output);
		tickInFlight = true;
		requestedDelay = undefined;
		const date = new Date().toISOString().slice(0, 10);
		pi.sendUserMessage(renderTickMessage({ prompt: loop.prompt, iteration: loop.iteration, selfPaced: loop.intervalSeconds === undefined, date, when }));
		if (loop.intervalSeconds !== undefined) schedule(nextRunAt(startedAt, loop.intervalSeconds, Date.now()));
		else setStatus(`loop auto · giro ${loop.iteration} · in corso`);
	};

	pi.on("agent_settled", () => {
		if (!state) return;
		if (tickInFlight) {
			tickInFlight = false;
			if (state.intervalSeconds === undefined) {
				if (requestedDelay === undefined) return stop("il modello non ha chiesto un altro giro (lavoro concluso)");
				schedule(Date.now() + requestedDelay * 1000);
				requestedDelay = undefined;
				return;
			}
		}
		if (state.pending) void tick();
	});

	pi.on("session_shutdown", () => {
		if (timer) clearTimeout(timer);
		timer = undefined;
		state = undefined;
		context = undefined;
	});

	pi.registerTool({
		name: "loop_next",
		label: "Loop next",
		description: "Schedule the next run of the current self-paced /loop. Call it at the end of a run only if the loop should continue; not calling it ends the loop.",
		parameters: {
			type: "object",
			properties: {
				delaySeconds: { type: "number", description: "Seconds until the next run (60-3600)" },
				reason: { type: "string", description: "Why this delay" },
			},
			required: ["delaySeconds", "reason"],
		} as never,

		async execute(_toolCallId, params) {
			const { delaySeconds } = params as { delaySeconds: number; reason: string };
			if (!state || state.intervalSeconds !== undefined) return { content: [{ type: "text", text: "Nessun loop a ritmo libero attivo." }], details: undefined };
			requestedDelay = clampDelay(delaySeconds, Math.min(60, minSeconds));
			return { content: [{ type: "text", text: `Prossimo giro tra ${requestedDelay}s.` }], details: undefined };
		},
	});

	// Inactive until a self-paced loop starts: no cost on ordinary requests.
	// session_start covers the TUI; before_agent_start covers print/json runs, where session_start may not fire.
	const hideWhenIdle = () => {
		if (state?.intervalSeconds === undefined && state) return;
		if (pi.getActiveTools().includes("loop_next")) setLoopNextActive(false);
	};
	pi.on("session_start", hideWhenIdle);
	pi.on("before_agent_start", hideWhenIdle);

	pi.registerCommand("loop", {
		description: "Ripete un prompt: /loop 5m <prompt> · /loop <prompt> (ritmo del modello) · /loop 10m --when \"cmd\" <prompt> · /loop stop",
		handler: async (args, ctx) => {
			context = ctx;
			const parsed = parseLoopArgs(args, minSeconds);
			if (parsed.kind === "error") return ctx.ui.notify(`/loop: ${parsed.message}`, "warning");
			if (parsed.kind === "status") return ctx.ui.notify(state ? `${renderLoopStatus(state)} — ${state.prompt}` : "Nessun loop attivo.", "info");
			if (parsed.kind === "stop") return state ? stop("richiesto dall'utente") : ctx.ui.notify("Nessun loop attivo.", "info");
			if (ctx.mode !== "tui") return ctx.ui.notify("/loop funziona solo nella TUI interattiva.", "warning");
			if (state) return ctx.ui.notify("C'è già un loop attivo: /loop stop per fermarlo.", "warning");

			const now = Date.now();
			state = { prompt: parsed.prompt, intervalSeconds: parsed.intervalSeconds, when: parsed.when, forSeconds: parsed.forSeconds, startedAt: now, iteration: 0, nextRunAt: now, pending: false };
			if (parsed.intervalSeconds === undefined) setLoopNextActive(true);
			ctx.ui.notify(`Loop avviato (${parsed.intervalSeconds === undefined ? "ritmo libero" : `ogni ${formatDuration(parsed.intervalSeconds)}`}${parsed.when ? `, solo se \`${parsed.when}\` fallisce` : ""}, scade tra ${formatDuration(parsed.forSeconds)}).`, "info");
			void tick();
		},
	});
}
