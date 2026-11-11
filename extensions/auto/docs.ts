/**
 * Project documents auto mode requires before planning (from "write these 6 documents before an AI builds your app"):
 * PRD, TRD, app flow, design system, back-end schema, implementation plan. They live in the vault (`<vault>/progetto/`,
 * so /vault indexes them), are project-level (written once, reused by every run) and are checked on every run.
 * Missing ones are drafted by a define step with `stato: bozza` (left for the user to review: a draft counts as
 * written) and the run goes on. Pure functions: the loop owns the side effects.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { findVault } from "../vault/scan.ts";

export interface ProjectDoc {
	file: string;
	title: string;
	/** What the document must answer, in the prompt and in the stop message. */
	content: string;
}

export const PROJECT_DOCS: ProjectDoc[] = [
	{ file: "prd.md", title: "PRD", content: "cosa fa il prodotto, per chi è, cosa resta fuori" },
	{ file: "trd.md", title: "TRD", content: "con quali pezzi si monta: linguaggi, database, login, pagamenti, hosting, integrazioni" },
	{ file: "flusso.md", title: "Flusso", content: "tutte le schermate o i comandi e cosa succede a ogni azione dell'utente" },
	{ file: "design.md", title: "Design system", content: "colori, caratteri, componenti, angoli, spazi (o lo stile dell'output se non c'è grafica)" },
	{ file: "schema.md", title: "Schema dati", content: "tabelle o strutture, campi, relazioni, chi può leggere o modificare ogni dato" },
	{ file: "piano.md", title: "Piano di implementazione", content: "l'ordine in cui costruire, a piccoli passi testati uno per volta" },
];

/** Minimum non-blank characters of body (frontmatter and headings excluded) for a document to count as written. */
const MIN_BODY = 40;

/** Folder of the documents, relative to the worktree: `<vault>/progetto` when the worktree has a vault, else `vault/progetto`. */
export function docsDir(worktree: string): string {
	// Empty env: PI_VAULT may point at the main checkout, which the sandbox keeps read-only.
	const vault = findVault(worktree, {});
	const rel = vault ? relative(worktree, vault) : "";
	return join(rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : "vault", "progetto");
}

export type DocState = "manca" | "bozza" | "ok";

function split(text: string): { front: string; body: string } {
	const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
	return match ? { front: match[1], body: text.slice(match[0].length) } : { front: "", body: text };
}

export function docState(text: string | undefined): DocState {
	if (text === undefined) return "manca";
	const { front, body } = split(text);
	const prose = body
		.split("\n")
		.filter((line) => !/^\s*#/.test(line))
		.join("")
		.replace(/\s+/g, "");
	if (prose.length < MIN_BODY) return "manca";
	return /^stato:\s*bozza\s*$/m.test(front) ? "bozza" : "ok";
}

export function docsStatus(worktree: string, dir = docsDir(worktree)): Record<DocState, ProjectDoc[]> {
	const out: Record<DocState, ProjectDoc[]> = { manca: [], bozza: [], ok: [] };
	for (const doc of PROJECT_DOCS) {
		const path = join(worktree, dir, doc.file);
		out[docState(existsSync(path) ? readFileSync(path, "utf8") : undefined)].push(doc);
	}
	return out;
}
