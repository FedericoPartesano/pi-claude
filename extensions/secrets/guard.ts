/**
 * Pure logic of the secrets extension: placeholder substitution into bash commands, sink/exfiltration checks,
 * sudo askpass rewrite and output scrubbing. Heuristic, not a security boundary (same stance as protected-paths.ts):
 * it blocks the known ways to print or ship a value, and scrubs what still comes back.
 */
import { randomBytes } from "node:crypto";
import type { Secret } from "./store.ts";

export const PLACEHOLDER = /\{\{secret:([A-Za-z][A-Za-z0-9_-]*)(?:\.(user|password|url))?\}\}/g;

export type Plan =
	| { ok: true; command: string; used: string[]; confirm: string[]; sudo: boolean; changed: boolean }
	| { ok: false; reason: string };

/** What the plan needs to look up; the Vault satisfies it. */
export interface Lookup { get(name: string): Secret | undefined }

const MARK = "\u0001";
const PRINTERS = new Set(["echo", "printf", "print", "printenv", "declare", "typeset", "compgen", "eval", "source", ".", "trap"]);
const INTERPRETERS = new Set(["python", "python2", "python3", "node", "nodejs", "deno", "bun", "perl", "ruby", "php", "lua", "awk", "gawk", "mawk", "sh", "bash", "zsh", "dash", "ksh", "fish", "xargs", "osascript", "powershell", "pwsh"]);
const NETWORK = new Set(["curl", "wget", "http", "https", "xh", "nc", "ncat", "netcat", "socat", "ssh", "scp", "sftp", "rsync", "ftp", "lftp", "telnet", "git"]);
const BARE_HOST_TOOLS = new Set(["nc", "ncat", "netcat", "socat", "telnet", "ftp", "lftp", "ssh", "curl", "wget", "http", "https", "xh"]);
const WRAPPERS = new Set(["command", "time", "nohup", "exec", "builtin", "setsid", "sudo", "doas", "nice", "timeout", "env", "stdbuf"]);

export const hostOf = (url: string): string | undefined => {
	try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase() || undefined; } catch { return undefined; }
};
const hostMatches = (host: string, bound: string) => host === bound || host.endsWith(`.${bound}`);

/** Resolves one placeholder to its value. */
function resolve(name: string, field: string | undefined, secret: Secret | undefined): { value: string } | { error: string } {
	if (!secret) return { error: `segreto «${name}» inesistente (vedi /secret list)` };
	if (secret.kind === "sudo") return { error: `«${name}» è la password sudo: non si inietta, scrivi solo sudo …` };
	if (secret.kind === "var") {
		if (field === "url" && secret.url) return { value: secret.url };
		if (!field) return { value: secret.value };
		return { error: `«${name}» è una variabile: usa {{secret:${name}}}` };
	}
	if (field === "user" || field === "password" || field === "url") return { value: secret[field] };
	return { error: `«${name}» è un login: usa {{secret:${name}.user}}, .password o .url` };
}

/** Command word of a segment and its remaining words, past env assignments and wrappers (sudo, time, env…). */
function commandWord(segment: string): { word: string; rest: string[] } {
	const tokens = segment.trim().split(/\s+/).filter(Boolean);
	let i = 0;
	let sawEnv = false;
	for (;;) {
		while (i < tokens.length && /^[A-Za-z_]\w*=/.test(tokens[i])) i++;
		const base = (tokens[i] ?? "").replace(/^.*\//, "").toLowerCase();
		if (!WRAPPERS.has(base)) return { word: base, rest: tokens.slice(i + 1) };
		if (base === "env") sawEnv = true;
		i++;
		while (i < tokens.length && tokens[i].startsWith("-")) i += /^-[ugCrtUhp]$/.test(tokens[i]) && base === "sudo" ? 2 : 1;
		if (base === "timeout") i++;
		if (i >= tokens.length) return { word: sawEnv ? "env" : base, rest: [] };
	}
}

function hostsIn(segment: string, bare: boolean): string[] | "unverifiable" {
	const hosts: string[] = [];
	for (const m of segment.matchAll(/[a-z][a-z0-9+.-]*:\/\/([^/\s'"?#]*)/gi)) {
		const authority = m[1].slice(m[1].lastIndexOf("@") + 1).replace(/:\d*$/, "").toLowerCase();
		if (!authority || /[$`(){}\u0001]/.test(authority)) return "unverifiable";
		hosts.push(authority);
	}
	for (const m of segment.matchAll(/(?:^|\s)[\w.-]*@([A-Za-z0-9.-]+)(?::|\s|$)/g)) hosts.push(m[1].toLowerCase());
	if (bare) for (const t of segment.split(/\s+/)) if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(t) && !/\.(json|txt|log|sh|md|ya?ml|tar|gz|zip|html|js|ts|py)$/i.test(t)) hosts.push(t.toLowerCase());
	if (/--resolve|--connect-to|--proxy|--unix-socket|(^|\s)-x\s/.test(segment)) return "unverifiable";
	return hosts;
}

/** Rewrites bare `sudo` command words to `sudo -A`; true when something changed. */
function rewriteSudo(command: string): { command: string; sudo: boolean; stdin: boolean } {
	let sudo = false;
	let stdin = false;
	const out = command.replace(/(^|[;&|(\n`]\s*)((?:[A-Za-z_]\w*=\S*\s+)*)sudo(?=\s|$)((?:\s+-[A-Za-z-]+)*)/g, (whole, pre: string, env: string, opts: string) => {
		if (/(^|\s)(-[A-Za-z]*S[A-Za-z]*|--stdin)(?=\s|$)/.test(opts)) stdin = true;
		sudo = true;
		return /(^|\s)(-[A-Za-z]*A[A-Za-z]*|--askpass)(?=\s|$)/.test(opts) ? whole : `${pre}${env}sudo -A${opts}`;
	});
	return { command: out, sudo, stdin };
}

/** Single place that turns a command with placeholders into the one to run, or says why not. */
export function plan(command: string, vault: Lookup, askpass?: string): Plan {
	if (/secrets\.enc|secrets\/store\.ts/.test(command)) return { ok: false, reason: "l'archivio dei segreti non si tocca da un comando" };
	const found = [...command.matchAll(PLACEHOLDER)];
	const rewritten = rewriteSudo(command);
	if (rewritten.stdin) return { ok: false, reason: "sudo -S non è consentito: la password passa dall'askpass, senza riga di comando" };
	if (!found.length && !rewritten.sudo) return { ok: true, command, used: [], confirm: [], sudo: false, changed: false };
	if (!found.length) {
		const prefix = askpass ? `export SUDO_ASKPASS=${shq(askpass)}; ` : "";
		return { ok: true, command: prefix + rewritten.command, used: [], confirm: [], sudo: true, changed: Boolean(prefix) || rewritten.command !== command };
	}

	const values: { name: string; field?: string; value: string; secret: Secret }[] = [];
	for (const m of found) {
		const secret = vault.get(m[1]);
		const r = resolve(m[1], m[2], secret);
		if ("error" in r) return { ok: false, reason: r.error };
		values.push({ name: m[1], field: m[2], value: r.value, secret: secret as Secret });
	}

	// Whole-command checks: once an env var carries the value, anything that can print or list it is out.
	if (/<<-?\s*['"]?\w/.test(command) || /<<</.test(command)) return { ok: false, reason: "heredoc o here-string con un segreto: stamperebbe il valore" };
	if (/\/proc\/|\/dev\/(tcp|udp)\/|\$\{!|\$ENV\b|\bjq\b[^|;&]*\benv\b|\bexport\s+-p\b|\bexport\s*(;|&|\||$)|\benv\s*(;|&|\||$)|__PI_S/.test(command)) return { ok: false, reason: "il comando può elencare o spedire l'ambiente: non consentito con un segreto" };

	// A .url placeholder is the bound address itself (not a secret): show its real host to the check instead of an opaque mark.
	const tokenized = command.replace(PLACEHOLDER, (_m, n: string, f?: string) => {
		const u = f === "url" ? values.find((v) => v.name === n && v.field === "url")?.value : undefined;
		return u && !/[\s$`(){}'"\\;&|<>]/.test(u) ? u : `${MARK}0${MARK}`;
	});
	const segments = tokenized.split(/[;&|\n()`{}]+/);
	const confirm = new Set<string>();
	for (const segment of segments) {
		const { word, rest } = commandWord(segment);
		const printsEnv = word === "env" ? !rest.length : word === "set" ? !rest.length || rest.some((t) => /^[-+]\w*[xv]|xtrace|verbose/.test(t)) : PRINTERS.has(word) && word !== "set";
		if (printsEnv) return { ok: false, reason: `«${word}» stamperebbe il segreto: usalo solo come argomento di un comando che lo consuma (curl, git, ssh…)` };
		if (word.startsWith(MARK)) return { ok: false, reason: "un segreto non può essere la parola di comando" };
		if (INTERPRETERS.has(word)) confirm.add(`«${word}» riceve un segreto e potrebbe stamparlo o inviarlo`);
	}
	// Network tools: every host must be the one the secret is bound to.
	const sensitive = values.map((v) => v.secret);
	const bounds = new Set<string>();
	let unbound = false;
	for (const s of sensitive) {
		const u = s.kind === "login" ? s.url : s.kind === "var" ? s.url : undefined;
		const h = u && hostOf(u);
		if (h) bounds.add(h); else unbound = true;
	}
	const net = segments.some((segment) => NETWORK.has(commandWord(segment).word));
	if (net) {
		const hosts = hostsIn(tokenized, true);
		if (hosts === "unverifiable") return { ok: false, reason: "host di destinazione non verificabile (variabili, proxy o --resolve): non invio un segreto" };
		if (unbound) {
			if (!hosts.length || bounds.size === 0) confirm.add("variabile senza host legato inviata in rete");
			else confirm.add(`variabile senza host legato verso ${[...new Set(hosts)].join(", ")}`);
		}
		for (const bound of bounds) {
			if (!hosts.length) return { ok: false, reason: `nessun host nel comando: il segreto è legato a ${bound}` };
			const bad = hosts.find((h) => !hostMatches(h, bound));
			if (bad) return { ok: false, reason: `il segreto è legato a ${bound}, il comando contatta ${bad}` };
		}
	}

	// Substitution: the value never lands in the command text, only in an env var set by a prefix, referenced quote-aware.
	const tag = randomBytes(5).toString("hex");
	const exports: string[] = [];
	let out = "";
	let state: "n" | "s" | "d" = "n";
	let k = 0;
	for (let i = 0; i < rewritten.command.length; i++) {
		const rest = rewritten.command.slice(i);
		if (rest.startsWith("{{secret:")) {
			const m = new RegExp(PLACEHOLDER.source, "y");
			const hit = m.exec(rest);
			if (hit) {
				const v = values[k];
				const varName = `__PI_${tag}_${k}`;
				exports.push(`${varName}=${shq(v.value)}`);
				out += state === "s" ? `'"\${${varName}}"'` : state === "d" ? `\${${varName}}` : `"\${${varName}}"`;
				k++;
				i += hit[0].length - 1;
				continue;
			}
		}
		const ch = rewritten.command[i];
		if (ch === "\\" && state !== "s") { out += ch + (rewritten.command[i + 1] ?? ""); i++; continue; }
		if (ch === "'" && state !== "d") state = state === "s" ? "n" : "s";
		else if (ch === '"' && state !== "s") state = state === "d" ? "n" : "d";
		out += ch;
	}
	const prefix = `${exports.length ? `export ${exports.join(" ")}; ` : ""}${rewritten.sudo && askpass ? `export SUDO_ASKPASS=${shq(askpass)}; ` : ""}`;
	return { ok: true, command: prefix + out, used: [...new Set(values.map((v) => v.name))], confirm: [...confirm], sudo: rewritten.sudo, changed: true };
}

export const shq = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** Forms in which a value could come back in a result: raw, base64 (with and without newline), hex, URL-encoded, reversed. */
export function variants(value: string): string[] {
	const b = Buffer.from(value);
	const set = new Set([value, b.toString("base64"), Buffer.from(`${value}\n`).toString("base64"), b.toString("base64url"), b.toString("hex"), encodeURIComponent(value), [...value].reverse().join("")]);
	for (const v of [...set]) set.add(v.replace(/=+$/, ""));
	return [...set].filter((v) => v.length >= 3).sort((a, b2) => b2.length - a.length);
}

/** Removes every known secret (in the variants above) from a text. */
export function scrub(text: string, secrets: { name: string; value: string }[]): { text: string; hits: string[] } {
	let out = text;
	const hits: string[] = [];
	for (const { name, value } of secrets) {
		for (const form of variants(value)) {
			if (out.includes(form)) { out = out.split(form).join(`[secret:${name}]`); if (!hits.includes(name)) hits.push(name); }
		}
	}
	return { text: out, hits };
}
