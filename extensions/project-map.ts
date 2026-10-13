/**
 * Project map: a short, stable overview of the working folder (folders with file counts, biggest source files) plus a
 * three-line search guide, appended to the system prompt once per session. The text never changes inside a session, so
 * the cache keeps it. PI_PROJECT_MAP=0 turns it off.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_CHARS = 3200;
const GUIDE = [
	"Ricerca nel progetto: usa `rg -n -C2 'a|b|c'` con più parole in una sola chiamata invece di una ricerca per parola.",
	"Leggi solo l'intervallo che serve (`sed -n 'A,Bp'`), non il file intero. Se servono più file indipendenti, chiedili nello stesso turno.",
	"La mappa qui sotto è una guida: i numeri di riga e i nomi vanno verificati nel codice prima di affermarli.",
].join("\n");

export function buildMap(files: string[], sizes: Map<string, number>): string {
	const dirs = new Map<string, number>();
	for (const file of files) {
		const parts = file.split("/");
		const key = parts.length > 2 ? `${parts[0]}/${parts[1]}/` : parts.length > 1 ? `${parts[0]}/` : "./";
		dirs.set(key, (dirs.get(key) ?? 0) + 1);
	}
	const dirLines = [...dirs].sort((a, b) => b[1] - a[1]).slice(0, 35).map(([dir, count]) => `${dir} (${count})`);
	const source = /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|cs|md)$/;
	const big = files.filter((f) => source.test(f) && !/(^|\/)(test|tests|__tests__|dist|build|node_modules)\//.test(f))
		.sort((a, b) => (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0)).slice(0, 25).map((f) => `${f} ${Math.round((sizes.get(f) ?? 0) / 1000)}k`);
	return `Mappa del progetto (${files.length} file)\nCartelle: ${dirLines.join(", ")}\nFile sorgente più grandi: ${big.join(", ")}`.slice(0, MAX_CHARS);
}

export function readProject(cwd: string): string | undefined {
	try {
		const files = execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8", maxBuffer: 64e6, stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter(Boolean);
		if (files.length < 20) return undefined;
		const sizes = new Map<string, number>();
		
		for (const f of files.slice(0, 20000)) try { sizes.set(f, statSync(`${cwd}/${f}`).size); } catch {}
		return `${GUIDE}\n${buildMap(files, sizes)}`;
	} catch { return undefined; }
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_PROJECT_MAP === "0") return;
	let cached: { cwd: string; text: string | undefined } | undefined;
	pi.on("before_agent_start", (event, ctx) => {
		if (!cached || cached.cwd !== ctx.cwd) cached = { cwd: ctx.cwd, text: readProject(ctx.cwd) };
		if (!cached.text) return;
		if (event.systemPrompt.includes("Mappa del progetto (")) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${cached.text}` };
	});
}
