/**
 * `pi secret add|list|rm NAME`: manage the store from a shell, with the typed secret never echoed.
 * IO is injected so the flow is testable; the real one reads hidden input from the terminal.
 */
import { createInterface } from "node:readline";
import { build, fieldsFor, KINDS, type Kind } from "./fields.ts";
import { NAME_RE, Vault, defaultPath } from "./store.ts";

export interface IO {
	line(prompt: string): Promise<string>;
	hidden(prompt: string): Promise<string>;
	out(text: string): void;
}

export async function unlockWithPrompt(vault: Vault, io: IO): Promise<boolean> {
	if (vault.unlocked) return true;
	if (!vault.exists) {
		const a = await io.hidden("Nuova passphrase dell'archivio: ");
		const b = await io.hidden("Ripeti la passphrase: ");
		if (!a || a !== b) { io.out("Le passphrase non coincidono."); return false; }
		return vault.unlock(a);
	}
	const ok = vault.unlock(process.env.PI_SECRETS_PASSPHRASE ?? (await io.hidden("Passphrase dell'archivio: ")));
	if (!ok) io.out("Passphrase sbagliata o archivio danneggiato.");
	return ok;
}

export async function runCli(args: string[], io: IO, path: string = defaultPath()): Promise<number> {
	const [cmd, name] = args;
	const vault = new Vault(path);
	if (cmd === "list") {
		if (!(await unlockWithPrompt(vault, io))) return 1;
		const names = vault.names();
		io.out(names.length ? names.map((n) => `${n}\t${vault.get(n)?.kind ?? "?"}`).join("\n") : "Nessun segreto.");
		return 0;
	}
	if (cmd === "rm") {
		if (!name) { io.out("Uso: pi secret rm NOME"); return 2; }
		if (!(await unlockWithPrompt(vault, io))) return 1;
		io.out(vault.remove(name) ? `Rimosso ${name}.` : `${name}: non esiste.`);
		return 0;
	}
	if (cmd === "add") {
		if (!name || !NAME_RE.test(name)) { io.out("Uso: pi secret add NOME [var|login|sudo]  (nome: lettere, cifre, _ e -)"); return 2; }
		const kind = (args[2] ?? (name === "sudo" ? "sudo" : "var")) as Kind;
		if (!KINDS.includes(kind)) { io.out(`Tipo sconosciuto «${kind}»: var, login o sudo.`); return 2; }
		if (!(await unlockWithPrompt(vault, io))) return 1;
		const answers: Record<string, string> = {};
		for (const f of fieldsFor(kind)) answers[f.key] = await (f.secret ? io.hidden : io.line)(`${f.label}: `);
		const secret = build(kind, answers);
		if (typeof secret === "string") { io.out(`Non salvato: ${secret}.`); return 1; }
		vault.set(name, secret);
		io.out(`Salvato ${name} (${kind}).`);
		return 0;
	}
	io.out("Uso: pi secret add NOME [var|login|sudo] | list | rm NOME");
	return cmd ? 2 : 0;
}

let pipedLines: AsyncIterator<string> | undefined;

/** Real terminal IO: hidden input reads raw keys without echo. */
export function terminalIO(): IO {
	const read = (prompt: string, hide: boolean) => new Promise<string>((resolve, reject) => {
		const stdin = process.stdin;
		if (!stdin.isTTY) {
			// Piped input (scripts): one shared line iterator, so lines buffered by an earlier read are not lost.
			process.stderr.write(prompt);
			pipedLines ??= createInterface({ input: stdin })[Symbol.asyncIterator]();
			pipedLines.next().then((r) => resolve(r.done ? "" : r.value), reject);
			return;
		}
		process.stderr.write(prompt);
		let value = "";
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");
		const onData = (chunk: string) => {
			for (const ch of chunk) {
				if (ch === "\r" || ch === "\n") { cleanup(); process.stderr.write("\n"); return resolve(value); }
				if (ch === "\u0003") { cleanup(); process.stderr.write("\n"); return reject(new Error("annullato")); }
				if (ch === "\u007f" || ch === "\b") { value = value.slice(0, -1); continue; }
				if (ch >= " ") { value += ch; if (!hide) process.stderr.write(ch); }
			}
		};
		const cleanup = () => { stdin.off("data", onData); stdin.setRawMode(false); stdin.pause(); };
		stdin.on("data", onData);
	});
	return { line: (p) => read(p, false), hidden: (p) => read(p, true), out: (t) => console.log(t) };
}
