import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Crew-resource-management style protocol between the manager and team agents.
 *
 * Borrowed from FAA AC 120-51E and ACT ARC Rec. 15-10: a fixed briefing, a closing callout the agent
 * must give ("STATO: ..."), and a way to say "I cannot / I disagree" without inventing a result.
 * Parsing is tolerant: an agent that gives no callout is treated like before (legacy free text).
 */

export type CalloutKind = "done" | "blocked" | "deviation" | "disagree";

export interface Callout {
	kind: CalloutKind;
	/** Free text after the keyword (reason, file, proof); empty when absent. */
	detail: string;
}

const KEYWORDS: Record<string, CalloutKind> = {
	FATTO: "done",
	BLOCCATO: "blocked",
	DEVIAZIONE: "deviation",
	DISACCORDO: "disagree",
};

/** The last `STATO:` line of an answer, or undefined when the agent gave none. */
export function parseCallout(text: string): Callout | undefined {
	const matches = [...text.matchAll(/^[ \t]*STATO:[ \t]*(FATTO|BLOCCATO|DEVIAZIONE|DISACCORDO)\b[ \t]*(?:[—–:-][ \t]*)?(.*)$/gim)];
	const last = matches.at(-1);
	if (!last) return undefined;
	return { kind: KEYWORDS[last[1].toUpperCase()], detail: last[2].trim() };
}

/** True for callouts that mean "do not retry the same prompt": the agent cannot or will not proceed. */
export function isHalting(callout: Callout | undefined): callout is Callout {
	return callout?.kind === "blocked" || callout?.kind === "disagree";
}

/**
 * Fixed closing instructions, identical for every task (stable prefix). They REPLACE the free-text
 * "## Risultati": a few terse lines plus one status word, which is what downstream tasks read.
 */
export const CALLOUT_INSTRUCTIONS = [
	"Ruoli: tu scrivi, il manager esegue i controlli, il revisore legge il diff. Non rilanciare test o build.",
	"Prima azione: UNA chiamata bash che legge tutti i file che ti servono. Poi modifica e chiudi.",
	"Chiusura (al posto di \"## Risultati\"): al massimo 4 righe \"percorso: cosa\", poi l'ultima riga, una sola:",
	"STATO: FATTO | DEVIAZIONE — <cosa e perché> | BLOCCATO — <cosa manca> | DISACCORDO — <cosa è sbagliato, prova>",
	"BLOCCATO e DISACCORDO sono risposte valide: non inventare un risultato.",
].join("\n");

/** Reviewer line under the protocol: the diff is handed over, so no tool call is needed to find it. */
export const REVIEW_INSTRUCTIONS = "Il diff del lavoro è qui sotto: giudica da questo senza altre letture (usa i tool solo per un dubbio preciso). I controlli sono già verdi: non rilanciarli. Rispondi con le sole righe che portano un fatto, poi VERDETTO.";

const BRIEF_CHARS = 9000;

/**
 * The declared files of a task, already read, as one block (the briefing): the agent starts with the big
 * picture instead of spending a turn to find it. Only existing regular files; "" when over the cap, so
 * large files are still read by the agent.
 */
export async function taskBriefing(cwd: string, files: string[] | undefined): Promise<string> {
	const { readFile, stat } = await import("node:fs/promises");
	const { resolve, sep } = await import("node:path");
	const parts: string[] = [];
	let total = 0;
	for (const file of files ?? []) {
		if (file.endsWith("/")) continue;
		const path = resolve(cwd, file);
		if (!path.startsWith(resolve(cwd) + sep)) continue;
		try {
			if (!(await stat(path)).isFile()) continue;
			const text = await readFile(path, "utf8");
			total += text.length;
			if (total > BRIEF_CHARS) return "";
			parts.push(`### ${file}\n${text}`);
		} catch {
			// a file the task will create: nothing to hand over
		}
	}
	return parts.length ? `File del compito, già letti (non rileggerli, modificali direttamente; i nuovi vanno creati):\n\n${parts.join("\n\n")}` : "";
}

const MATERIAL_CHARS = 16000;
const git = promisify(execFile);

/**
 * Status, diff and new files of the working tree as one block for the reviewer; "" when git fails or the
 * block exceeds MATERIAL_CHARS (the reviewer then reads with its tools, as before).
 */
export async function reviewMaterial(cwd: string): Promise<string> {
	const run = async (...args: string[]) => (await git("git", args, { cwd, maxBuffer: 4_000_000, timeout: 20_000 })).stdout;
	try {
		const status = (await run("status", "--short")).split("\n").filter((line) => line && !/^\?\? \.pi\//.test(line)).join("\n");
		if (!status) return "";
		const diff = await run("diff", "HEAD");
		const untracked = (await run("ls-files", "--others", "--exclude-standard")).split("\n").filter((file) => file && !file.startsWith(".pi/"));
		const fresh: string[] = [];
		for (const file of untracked) fresh.push(`### nuovo: ${file}\n${await run("show", `:${file}`).catch(async () => (await import("node:fs/promises")).readFile(`${cwd}/${file}`, "utf8"))}`);
		const block = `${status}\n\n${diff}\n${fresh.join("\n")}`.trim();
		return block.length > MATERIAL_CHARS ? "" : block;
	} catch {
		return "";
	}
}

/** Cap on the summary of a task that gave a callout: the status word carries the rest. */
export const CALLOUT_SUMMARY_CHARS = 600;

/** The answer without its callout line, capped: what downstream tasks and notes receive. */
export function stripCallout(text: string): string {
	return text.replace(/^[ \t]*STATO:.*$/gim, "").replace(/^[\s\S]*## Risultati/, "").trim().slice(-CALLOUT_SUMMARY_CHARS);
}

/** Summary line for the board and the notes: a deviation stays visible to everyone downstream. */
export function withCallout(summary: string, callout: Callout | undefined): string {
	if (callout?.kind !== "deviation") return summary;
	return `⚠ Deviazione: ${callout.detail || "non specificata"}\n${summary}`;
}

/** Off with PI_TEAM_CRM=0: the control arm of the evaluation (free-text prompt, as before the protocol). */
export function crmEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
	return environment.PI_TEAM_CRM !== "0";
}
