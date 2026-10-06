// Simulated user for the intent evaluation: a product owner who knows only the hidden requirements and answers
// only what is asked. Runs Claude Code headless on the subscription (never --bare: that forces API-key billing),
// from an empty directory with only project settings, so the user's hooks and plugins do not leak in.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SYSTEM_PROMPT = (hidden) => [
	"Sei il product owner di una piccola libreria online. Stai rispondendo alle domande di uno sviluppatore che ti intervista su una richiesta che hai fatto.",
	"Conosci SOLO questi requisiti:",
	...hidden.map((requirement) => `- ${requirement}`),
	"",
	"Regole:",
	"- Rispondi in italiano, in modo breve e diretto, solo a ciò che ti viene chiesto in quest'ultimo messaggio.",
	"- Usa i requisiti per rispondere; se una domanda riguarda qualcosa che non è nei requisiti rispondi \"decidi tu\".",
	"- Non rivelare requisiti su cui non ti è stato chiesto nulla, anche se pensi che siano utili.",
	"- Non scrivere codice e non proporre soluzioni tecniche: sei l'utente, non lo sviluppatore.",
	"- Se il messaggio non contiene domande, rispondi solo \"ok, procedi\".",
].join("\n");

const emptyDirectory = mkdtempSync(join(tmpdir(), "sim-user-"));

/** Returns { text, inputTokens, outputTokens, seconds } for the simulated user's reply to `transcriptTail`. */
export function answer(hidden, transcriptTail, { model = "haiku", timeoutMs = 120_000 } = {}) {
	const started = Date.now();
	const args = [
		"-p", "--model", model, "--output-format", "json", "--no-session-persistence",
		"--setting-sources", "project", "--strict-mcp-config", "--tools", "",
		"--system-prompt", SYSTEM_PROMPT(hidden),
	];
	return new Promise((resolve) => {
		const child = spawn("claude", args, { cwd: emptyDirectory, stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-2000)));
		child.on("close", () => {
			clearTimeout(timer);
			const seconds = Math.round((Date.now() - started) / 100) / 10;
			try {
				const result = JSON.parse(stdout);
				const usage = result.usage ?? {};
				resolve({
					text: String(result.result ?? "").trim(),
					inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
					outputTokens: usage.output_tokens ?? 0,
					seconds,
					error: result.is_error ? String(result.result ?? result.subtype) : undefined,
				});
			} catch {
				resolve({ text: "decidi tu", inputTokens: 0, outputTokens: 0, seconds, error: `sim-user non valido: ${stderr || stdout.slice(0, 300)}` });
			}
		});
		child.stdin.end(`Messaggio dello sviluppatore:\n\n${transcriptTail}`);
	});
}

// Self-test: `node sim-user.mjs` asks one fake question.
if (import.meta.url === `file://${process.argv[1]}`) {
	const reply = await answer(
		["Il file è src/cart.js con la funzione cartTotal(lines, inventory, code).", "Il codice LIBRI10 vale 10% di sconto."],
		"Che sconti devono esistere? E c'è un limite alla quantità per riga?",
	);
	console.log(JSON.stringify(reply, null, 2));
}
