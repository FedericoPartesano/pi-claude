/**
 * Shared notes of one team run: a markdown file outside the project where the orchestrator writes every
 * finished task's results and agents can read (and append) what the others found. Direct dependencies
 * still arrive in the prompt; the notes cover everything else without costing tokens until read.
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TeamNotes {
	path: string;
	append(text: string): Promise<void>;
}

export async function createNotes(goal: string, directory = join(tmpdir(), "pi-team")): Promise<TeamNotes> {
	await mkdir(directory, { recursive: true });
	const path = join(directory, `notes-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.md`);
	await writeFile(path, `# Note condivise del team\n\nObiettivo: ${goal}\n`);
	return {
		path,
		// Agents may append too (bash >>): one write per call keeps lines whole.
		append: (text) => appendFile(path, `\n${text.trim()}\n`),
	};
}

/** The prompt lines that tell an agent where the notes are and how to use them. */
export function notesInstructions(path: string): string {
	return [
		`Note condivise del team: \`${path}\` (fuori dal progetto). Contengono i risultati dei compiti già finiti:`,
		"leggile se ti serve sapere cosa hanno trovato o cambiato gli altri. Se scopri qualcosa che serve agli altri",
		`(convenzioni, trappole, comandi utili), aggiungilo in fondo in una o due righe: \`echo "- <scoperta>" >> ${path}\`.`,
	].join(" ");
}
