import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { appendDictation, cleanTranscript, findPython, MAX_SECONDS, previewLines, recordArgs } from "./voice.ts";

test("transcripts: whitespace collapsed, Whisper's silence hallucinations dropped", () => {
	assert.equal(cleanTranscript("  aggiungi un test\n per lo sconto. "), "aggiungi un test per lo sconto.");
	for (const noise of ["Sottotitoli creati dalla comunità Amara.org", "Sottotitoli e revisione a cura di QTSS", "Grazie per la visione!", "Grazie.", "...", ""]) assert.equal(cleanTranscript(noise), "", noise);
	assert.equal(cleanTranscript("Grazie, ora correggi il bug"), "Grazie, ora correggi il bug");
	assert.equal(cleanTranscript("Aggiungi i sottotitoli al video"), "Aggiungi i sottotitoli al video");
});

test("dictation is appended to what was already typed", () => {
	assert.equal(appendDictation("", "ciao"), "ciao");
	assert.equal(appendDictation("rivedi  \n", "il carrello"), "rivedi il carrello");
});

test("ffmpeg streams raw 16 kHz mono to stdout with a time limit", () => {
	const args = recordArgs("0");
	assert.deepEqual(args.slice(args.indexOf("-i"), args.indexOf("-i") + 2), ["-i", ":0"]);
	assert.ok(args.includes("16000") && args.includes(String(MAX_SECONDS)) && args.includes("s16le"));
	assert.equal(args.at(-1), "pipe:1");
});

test("preview: wrapped to the width, only the newest lines, every line fits", () => {
	assert.deepEqual(previewLines("", 40), []);
	assert.deepEqual(previewLines("aggiungi un test", 40), ["  aggiungi un test"]);
	const long = Array.from({ length: 40 }, (_, i) => `parola${i}`).join(" ");
	const lines = previewLines(long, 30);
	assert.equal(lines.length, 3);
	assert.ok(lines[0]!.startsWith("  …"));
	assert.ok(lines.at(-1)!.endsWith("parola39"));
	for (const line of lines) assert.ok([...line].length <= 30, line);
	for (const line of previewLines("x".repeat(100), 20)) assert.ok([...line].length <= 20);
});

test("python: taken from mlx_whisper's shebang", () => {
	const folder = mkdtempSync(join(tmpdir(), "pi-voice-py-"));
	writeFileSync(join(folder, "mlx_whisper"), `#!${process.execPath}\nprint()\n`);
	chmodSync(join(folder, "mlx_whisper"), 0o755);
	const saved = process.env.PI_VOICE_PYTHON;
	delete process.env.PI_VOICE_PYTHON;
	try {
		assert.equal(findPython(folder), process.execPath);
		assert.equal(findPython(join(folder, "nowhere")), "python3");
	} finally {
		if (saved !== undefined) process.env.PI_VOICE_PYTHON = saved;
	}
});

// Real worker on a synthetic Italian sentence (macOS `say`), fed at about real time: partials, then the final.
const has = (command: string) => { try { execFileSync("which", [command]); return true; } catch { return false; } };
test("worker: partials while audio arrives, then the whole sentence", { skip: !(process.platform === "darwin" && has("say") && has("ffmpeg") && has("mlx_whisper")), timeout: 90_000 }, async () => {
	const folder = mkdtempSync(join(tmpdir(), "pi-voice-test-"));
	execFileSync("say", ["-v", "Alice", "-o", join(folder, "s.aiff"), "Aggiungi un test per il calcolo dello sconto nel carrello della spesa"]);
	execFileSync("ffmpeg", ["-loglevel", "error", "-i", join(folder, "s.aiff"), "-ac", "1", "-ar", "16000", "-f", "s16le", join(folder, "s.pcm")]);
	const pcm = readFileSync(join(folder, "s.pcm"));
	const worker = spawn(findPython(), ["-I", join(dirname(fileURLToPath(import.meta.url)), "voice-worker.py")], { stdio: ["pipe", "pipe", "inherit"] });
	const messages: Record<string, unknown>[] = [];
	const ready = new Promise<void>((resolve) => createInterface({ input: worker.stdout! }).on("line", (line) => {
		const message = JSON.parse(line);
		messages.push(message);
		if (message.ready) resolve();
	}));
	const closed = new Promise((resolve) => worker.on("close", resolve));
	await ready;
	const chunk = 16_000; // 0.5 s
	for (let offset = 0; offset < pcm.length; offset += chunk) {
		worker.stdin!.write(pcm.subarray(offset, offset + chunk));
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	worker.stdin!.end();
	await closed;
	assert.ok(messages.some((m) => typeof m.partial === "string" && m.partial), JSON.stringify(messages));
	const final = messages.find((m) => typeof m.final === "string")?.final as string;
	assert.match(final.toLowerCase(), /calcolo dello sconto nel carrello/);
});
