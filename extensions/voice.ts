/**
 * Voice dictation: Alt+M (or /voice) starts recording, the same key stops it, and the Italian
 * transcript goes into the editor, to read and send with Enter. While you talk, a grey preview above the
 * editor shows what has been understood so far; the editor is only touched at the end.
 *
 * Zero tokens and nothing sent anywhere: ffmpeg records the Mac microphone and pipes raw audio to
 * voice-worker.py, which keeps Whisper (mlx_whisper) loaded for this dictation only, transcribes the latest
 * audio every ~1.5 s and, once stopped, the whole recording. Claude Code's /voice instead streams the audio
 * to Anthropic (claude.ai login, interactive Claude Code only).
 * Nothing runs until the first use; no tool and no prompt text for the model.
 *
 * Environment:
 *   PI_VOICE_KEY=…      shortcut (default alt+m; alt+v and ctrl+v are Pi's image paste)
 *   PI_VOICE_MODEL=…    Whisper model (macOS: mlx-community/whisper-small-mlx; Linux/WSL: faster-whisper "small")
 *   PI_VOICE_DEVICE=…   audio input: avfoundation on macOS, PulseAudio on Linux/WSL (default "default"; WSLg provides it)
 *   PI_VOICE_PYTHON=…   Python with mlx_whisper (macOS; default: its shebang) or faster-whisper (Linux/WSL; default python3)
 *   PI_VOICE_STEP=…     seconds between live previews (macOS 1.5, Linux/WSL 4)
 * Linux/WSL setup: only ffmpeg (apt install ffmpeg). On first use the extension creates ~/.pi/voice-venv by
 * itself (uv, or python3 -m venv) and installs faster-whisper + numpy there; PI_VOICE_PYTHON skips all of it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const MAX_SECONDS = 120;
const MAC = process.platform === "darwin";
/** macOS: mlx_whisper (Apple Silicon). Linux/WSL: faster-whisper on CPU. */
const MODEL = process.env.PI_VOICE_MODEL ?? (MAC ? "mlx-community/whisper-small-mlx" : "small");
/** Seconds of new audio between live previews: a CPU without GPU needs longer to keep up. */
const STEP = process.env.PI_VOICE_STEP ?? (MAC ? "1.5" : "4");
const KEY = (process.env.PI_VOICE_KEY || "alt+m").toLowerCase();
const KEY_LABEL = KEY.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const DEVICE = process.env.PI_VOICE_DEVICE ?? "default";
const WORKER = join(dirname(fileURLToPath(import.meta.url)), "voice-worker.py");
/** Preview lines above the editor: the end of the text, so the newest words are always visible. */
export const PREVIEW_LINES = 3;

/** What Whisper writes on silence or noise, learnt from subtitles: never what the user said. */
const HALLUCINATIONS = [
	/^sottotitoli\b.*\b(a cura|creati|revisione|amara\.org)/i,
	/amara\.org/i,
	/^(grazie( a tutti)? per (la visione|l'ascolto|aver guardato)[.!]?)$/i,
	/^(grazie[.!]?|ciao[.!]?|\.+)$/i,
];

/** The transcript to put in the editor, or "" when it is only silence or a known hallucination. */
export function cleanTranscript(text: string): string {
	const clean = text.replace(/\s+/g, " ").trim();
	return HALLUCINATIONS.some((pattern) => pattern.test(clean)) ? "" : clean;
}

/** Editor text after dictation: appended to what was already typed. */
export function appendDictation(current: string, dictated: string): string {
	const before = current.trimEnd();
	return before ? `${before} ${dictated}` : dictated;
}

/** ffmpeg: microphone → raw 16 kHz mono s16le on stdout, stopped by "q" on stdin or the time limit. */
export const recordArgs = (device = DEVICE, mac = MAC) =>
	["-hide_banner", "-loglevel", "error", ...(mac ? ["-f", "avfoundation", "-i", `:${device}`] : ["-f", "pulse", "-i", device]), "-ac", "1", "-ar", "16000", "-t", String(MAX_SECONDS), "-f", "s16le", "pipe:1"];

/** The Python that has mlx_whisper: PI_VOICE_PYTHON, else the interpreter in the mlx_whisper script's shebang. */
export function findPython(path = process.env.PATH ?? ""): string {
	if (process.env.PI_VOICE_PYTHON) return process.env.PI_VOICE_PYTHON;
	for (const folder of path.split(delimiter)) {
		const script = join(folder, "mlx_whisper");
		if (!folder || !existsSync(script)) continue;
		const shebang = /^#!\s*(\S+)/.exec(readFileSync(script, "utf8").split("\n", 1)[0] ?? "")?.[1];
		if (shebang && existsSync(shebang)) return shebang;
	}
	return "python3";
}

export const VENV = join(homedir(), ".pi", "voice-venv");
const VENV_PYTHON = join(VENV, "bin", "python");

const run = (command: string, args: string[]) =>
	new Promise<{ ok: boolean; error: string }>((resolve) => {
		let error = "";
		const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
		child.stderr!.on("data", (chunk: Buffer) => (error = (error + chunk.toString("utf8")).slice(-400)));
		child.on("error", (e) => resolve({ ok: false, error: String(e.message) }));
		child.on("close", (code) => resolve({ ok: code === 0, error }));
	});

/** Linux/WSL without a configured Python: the private venv with faster-whisper, created on first use. Undefined: use findPython(). */
export async function ensureVenv(notify: (message: string) => void): Promise<string | undefined> {
	if (MAC || process.env.PI_VOICE_PYTHON) return undefined;
	const ready = async () => (await run(VENV_PYTHON, ["-c", "import numpy, faster_whisper"])).ok;
	if (existsSync(VENV_PYTHON) && (await ready())) return VENV_PYTHON;
	notify("Voce: prima configurazione (installo faster-whisper, un paio di minuti)…");
	let made = await run("uv", ["venv", "--clear", VENV]);
	if (made.ok) made = await run("uv", ["pip", "install", "--python", VENV_PYTHON, "faster-whisper", "numpy"]);
	else {
		made = await run("python3", ["-m", "venv", "--clear", VENV]);
		if (made.ok) made = await run(VENV_PYTHON, ["-m", "pip", "install", "faster-whisper", "numpy"]);
		else throw new Error(`non riesco a creare l'ambiente Python (installa uv o python3-venv). ${made.error.trim().split("\n").pop() ?? ""}`);
	}
	if (!made.ok || !(await ready())) throw new Error(`installazione di faster-whisper non riuscita. ${made.error.trim().split("\n").pop() ?? ""}`);
	return VENV_PYTHON;
}

/** Wraps the preview to the width and keeps the last lines. */
export function previewLines(text: string, width: number, max = PREVIEW_LINES): string[] {
	const room = Math.max(10, width - 2);
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		for (const piece of word.match(new RegExp(`.{1,${room}}`, "gu")) ?? []) {
			if (line && [...line].length + 1 + [...piece].length > room) {
				lines.push(line);
				line = piece;
			} else line = line ? `${line} ${piece}` : piece;
		}
	}
	if (line) lines.push(line);
	const shown = lines.slice(-max).map((l) => `  ${l}`);
	if (lines.length > max) shown[0] = `  …${shown[0]!.slice(3)}`;
	return shown;
}

const elapsed = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const describe = (error: unknown, program: string, install: string) =>
	(error as NodeJS.ErrnoException)?.code === "ENOENT" ? `${program} non trovato: ${install}` : String((error as Error)?.message ?? error);

type Dictation = { recorder: ChildProcess; worker: ChildProcess; final: Promise<string | undefined>; timer: ReturnType<typeof setInterval> };

export default function (pi: ExtensionAPI) {
	let state: "idle" | "preparing" | "recording" | "transcribing" = "idle";
	let current: Dictation | undefined;

	const preview = (ctx: ExtensionContext, text: string) => {
		if (!text) return ctx.ui.setWidget("voice", undefined);
		ctx.ui.setWidget("voice", (_tui, theme) => ({
			render: (width: number) => previewLines(text, width).map((line) => theme.fg("muted", line)),
			invalidate() {},
		}));
	};

	const start = (ctx: ExtensionContext, python: string) => {
		const worker = spawn(python, ["-I", WORKER, MODEL, STEP], { stdio: ["pipe", "pipe", "pipe"] });
		const recorder = spawn("ffmpeg", recordArgs(), { stdio: ["pipe", "pipe", "pipe"] });
		let failure: string | undefined;
		let workerErrors = "";
		let recorderErrors = "";
		worker.stderr!.on("data", (chunk: Buffer) => (workerErrors = (workerErrors + chunk.toString("utf8")).slice(-800)));
		recorder.stderr!.on("data", (chunk: Buffer) => (recorderErrors = (recorderErrors + chunk.toString("utf8")).slice(-600)));
		worker.on("error", (error) => (failure ??= describe(error, "python", "imposta PI_VOICE_PYTHON")));
		recorder.on("error", (error) => (failure ??= describe(error, "ffmpeg", MAC ? "brew install ffmpeg" : "sudo apt install ffmpeg")));
		worker.stdin!.on("error", () => {}); // the worker died: reported through its exit
		recorder.stdout!.pipe(worker.stdin!);

		let ready = false;
		let latest = "";
		const final = new Promise<string | undefined>((resolve) => {
			let result: string | undefined;
			createInterface({ input: worker.stdout! }).on("line", (line) => {
				let message: { ready?: boolean; partial?: string; final?: string };
				try { message = JSON.parse(line); } catch { return; }
				if (message.ready) ready = true;
				if (typeof message.partial === "string" && state === "recording") {
					latest = cleanTranscript(message.partial) || latest;
					preview(ctx, latest);
				}
				if (typeof message.final === "string") result = message.final;
			});
			worker.on("close", () => {
				if (result === undefined && !failure) {
					const last = workerErrors.trim().split("\n").pop() ?? "";
					failure = /No module named 'mlx_whisper'/.test(workerErrors) ? "mlx_whisper non trovato: pip install mlx-whisper (o imposta PI_VOICE_PYTHON)" : `trascrizione non riuscita. ${last}`;
				}
				resolve(result);
			});
		});
		recorder.on("close", (code) => {
			if (code !== 0 && code !== null && !failure) failure = `registrazione non riuscita (microfono? permesso del terminale in Impostazioni › Privacy › Microfono). ${recorderErrors.trim().split("\n").pop() ?? ""}`;
			// The -t limit or a failure stopped ffmpeg by itself: finish as if the user had pressed the key.
			if (state === "recording" && current?.recorder === recorder) void stop(ctx);
		});

		const started = Date.now();
		const show = () => {
			const time = elapsed(Math.round((Date.now() - started) / 1000));
			ctx.ui.setStatus("voice", ready ? `● ${time} parla · ${KEY_LABEL} per finire` : `● ${time} carico il modello, parla pure · ${KEY_LABEL} per finire`);
		};
		show();
		current = { recorder, worker, final: final.then((text) => (failure ? undefined : text)), timer: setInterval(show, 1000) };
		state = "recording";
		void final.then(() => {
			if (failure) ctx.ui.notify(`Voce: ${failure}`, "error");
		});
	};

	const stop = async (ctx: ExtensionContext) => {
		const dictation = current;
		if (!dictation) return;
		state = "transcribing";
		clearInterval(dictation.timer);
		ctx.ui.setStatus("voice", "◌ trascrivo…");
		try {
			// ffmpeg's own quit flushes the audio; its stdout closing ends the worker's input, which then does the full pass.
			if (dictation.recorder.exitCode === null) dictation.recorder.stdin!.end("q");
			const text = await dictation.final;
			if (text === undefined) return; // failure, already reported
			const clean = cleanTranscript(text);
			if (!clean) return ctx.ui.notify("Voce: non ho sentito niente.", "info");
			ctx.ui.setEditorText(appendDictation(ctx.ui.getEditorText(), clean));
		} finally {
			ctx.ui.setStatus("voice", undefined);
			ctx.ui.setWidget("voice", undefined);
			current = undefined;
			state = "idle";
		}
	};

	const toggle = async (ctx: ExtensionContext) => {
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		if (process.platform !== "darwin" && process.platform !== "linux") return ctx.ui.notify("Voce: solo su macOS e Linux/WSL.", "warning");
		if (state === "recording") return stop(ctx);
		if (state === "transcribing") return ctx.ui.notify("Voce: sto ancora trascrivendo.", "info");
		if (state === "preparing") return ctx.ui.notify("Voce: configurazione in corso, un attimo.", "info");
		state = "preparing";
		ctx.ui.setStatus("voice", "◌ preparo la voce…");
		try {
			const python = (await ensureVenv((message) => ctx.ui.setStatus("voice", `◌ ${message.replace(/^Voce:\s*/, "")}`))) ?? findPython();
			return start(ctx, python);
		} catch (error) {
			state = "idle";
			ctx.ui.setStatus("voice", undefined);
			ctx.ui.notify(`Voce: ${(error as Error).message}`, "error");
		}
	};

	pi.registerShortcut(KEY as Parameters<typeof pi.registerShortcut>[0], { description: "Dettatura vocale in italiano (premi di nuovo per finire)", handler: toggle });
	pi.registerCommand("voice", {
		description: `Dettatura vocale in italiano, trascritta in locale: avvia o ferma la registrazione (anche ${KEY_LABEL})`,
		handler: async (_args, ctx) => toggle(ctx),
	});

	pi.on("session_shutdown", async () => {
		if (!current) return;
		clearInterval(current.timer);
		current.recorder.kill("SIGKILL");
		current.worker.kill("SIGKILL");
	});
}
