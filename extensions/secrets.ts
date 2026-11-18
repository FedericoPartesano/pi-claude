/**
 * Secrets: private variables, site logins and the sudo password, usable from the chat without the model ever seeing them.
 * The model writes {{secret:name}} (or .user/.password/.url) in bash commands; this extension swaps in the real value
 * just before the command runs (the session log keeps the placeholder), scrubs values out of tool results, and gives
 * sudo its password through SUDO_ASKPASS after the user confirms the exact command. Heuristic, not a security boundary
 * (see docs/adr/0002). Store: extensions/secrets/store.ts (scrypt + AES-256-GCM, ~/.pi/secrets.enc).
 */
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { startAskpass, type Askpass } from "./secrets/askpass.ts";
import { build, fieldsFor, KINDS, type Kind } from "./secrets/fields.ts";
import { plan, scrub } from "./secrets/guard.ts";
import { NAME_RE, Vault, defaultPath, peekNames } from "./secrets/store.ts";

export const MARKER = "Segreti: ";
const LOCK = "\u{1F512}"; // titles starting with the lock are shown masked by the chat frontend

export default function (pi: ExtensionAPI) {
	if (process.env.PI_SECRETS === "off") return;
	const vault = new Vault(defaultPath());
	const auditFile = process.env.PI_SECRETS_AUDIT ?? join(homedir(), ".pi", "secrets-audit.log");
	let askpass: Askpass | undefined;
	const releases = new Map<string, () => void>();

	const audit = (line: string) => {
		try { mkdirSync(dirname(auditFile), { recursive: true }); appendFileSync(auditFile, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 }); } catch { /* audit is best effort */ }
	};

	/** Unlocks the store (passphrase asked in a masked dialog, or from PI_SECRETS_PASSPHRASE). */
	let unlocking: Promise<string | undefined> | undefined;
	// Parallel tool calls share one prompt instead of asking the passphrase once each.
	const ensureUnlocked = (ctx: ExtensionContext): Promise<string | undefined> => {
		if (vault.unlocked) return Promise.resolve(undefined);
		unlocking ??= unlock(ctx).finally(() => { unlocking = undefined; });
		return unlocking;
	};
	const unlock = async (ctx: ExtensionContext): Promise<string | undefined> => {
		const fromEnv = process.env.PI_SECRETS_PASSPHRASE;
		if (fromEnv !== undefined && vault.exists) return vault.unlock(fromEnv) ? undefined : "Passphrase dell'archivio dei segreti sbagliata (PI_SECRETS_PASSPHRASE).";
		if (!ctx.hasUI) return "Archivio dei segreti bloccato e nessuna interfaccia per chiedere la passphrase.";
		if (!vault.exists) {
			const a = await ctx.ui.input(`${LOCK} Nuova passphrase dell'archivio dei segreti`, "");
			if (!a) return "Archivio dei segreti non creato.";
			const b = await ctx.ui.input(`${LOCK} Ripeti la passphrase`, "");
			if (a !== b) return "Le passphrase non coincidono.";
			return vault.unlock(a) ? undefined : "Archivio non creato.";
		}
		for (let i = 0; i < 3; i++) {
			const p = await ctx.ui.input(`${LOCK} Passphrase dell'archivio dei segreti`, "");
			if (p === undefined) return "L'utente non ha sbloccato l'archivio dei segreti.";
			if (vault.unlock(p)) return undefined;
			ctx.ui.notify("Passphrase sbagliata.", "warning");
		}
		return "Passphrase sbagliata per tre volte.";
	};

	const WANTS = /\b(segret\w*|credenzial\w*|password|login|token|api[ -]?key|sudo)\b/i;
	pi.on("before_agent_start", (event) => {
		const names = peekNames(defaultPath());
		const at = event.systemPrompt.indexOf(`\n\n${MARKER}`);
		const base = at >= 0 ? event.systemPrompt.slice(0, at) : event.systemPrompt;
		const active = pi.getActiveTools();
		if ((names.length || WANTS.test(event.prompt ?? "")) && !active.includes("secret")) pi.setActiveTools([...active, "secret"]);
		const next = names.length ? `${base}\n\n${MARKER}tool secret (list/run/add) o {{secret:nome}} nei comandi bash (login .user/.password/.url); sudo usa la password salvata. Mai chiedere o stampare i valori. Disponibili: ${names.join(", ")}.` : base;
		return next === event.systemPrompt ? undefined : { systemPrompt: next };
	});

	/** Shared by the bash hook and the `secret` tool: resolves placeholders, asks confirmation, returns the command to run. */
	const prepare = async (command: string, toolCallId: string, ctx: ExtensionContext): Promise<{ command: string } | { block: string }> => {
		const touches = command.includes("{{secret:") || /\bsudo\b/.test(command) || command.includes("secrets.enc");
		if (!touches || !vault.exists) return { command };
		const err = await ensureUnlocked(ctx);
		if (err) return { block: err };
		const sudoName = vault.names().find((n) => vault.get(n)?.kind === "sudo");
		if (/\bsudo\b/.test(command) && sudoName && !askpass) askpass = await startAskpass();
		const p = plan(command, vault, sudoName ? askpass?.script : undefined);
		if (!p.ok) return { block: p.reason };
		if (p.confirm.length || p.sudo) {
			if (!ctx.hasUI) return { block: `Servirebbe una conferma dell'utente (${[...p.confirm, p.sudo ? "sudo" : ""].filter(Boolean).join("; ")}) e qui non c'è interfaccia.` };
			const why = [...p.confirm, ...(p.sudo ? ["gira come root con la password di sudo"] : [])].map((t) => `• ${t}`).join("\n");
			const ok = await ctx.ui.confirm("Segreti", `${command}\n\n${why}\n\nEseguire?`);
			if (!ok) { audit(`DENIED ${p.used.join(",")} :: ${command}`); return { block: "L'utente non ha confermato il comando con i segreti." }; }
		}
		if (p.sudo && sudoName && askpass) {
			const pw = (vault.get(sudoName) as { password: string }).password;
			releases.set(toolCallId, askpass.grant(() => pw));
		}
		audit(`RUN ${p.used.join(",") || "-"}${p.sudo ? " sudo" : ""} :: ${command}`);
		return { command: p.command };
	};

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;
		const input = event.input as { command?: unknown };
		const r = await prepare(typeof input.command === "string" ? input.command : "", event.toolCallId, ctx);
		if ("block" in r) return { block: true, reason: r.block };
		input.command = r.command;
		return undefined;
	});

	/** Asks the user for every field in masked dialogs and saves; the model never sees the typed values. Returns a message. */
	const askAndSave = async (name: string, k: string | undefined, ctx: ExtensionContext): Promise<string> => {
		const kind = (k ?? (name === "sudo" ? "sudo" : "var")) as Kind;
		if (!NAME_RE.test(name)) return "Nome non valido: lettere, cifre, _ e -, deve iniziare con una lettera.";
		if (!KINDS.includes(kind)) return "Tipo: var, login o sudo.";
		if (!ctx.hasUI) return "Serve l'interfaccia per chiedere i valori all'utente.";
		const err = await ensureUnlocked(ctx);
		if (err) return err;
		if (vault.get(name) && !(await ctx.ui.confirm("Segreti", `«${name}» esiste già. Sovrascrivere?`))) return "Annullato, niente salvato.";
		const answers: Record<string, string> = {};
		for (const f of fieldsFor(kind)) {
			const v = await ctx.ui.input(`${f.secret ? LOCK : ""}${name}: ${f.label}`, "");
			if (v === undefined) return "Annullato, niente salvato.";
			answers[f.key] = v;
		}
		const secret = build(kind, answers);
		if (typeof secret === "string") return `Non salvato: ${secret}.`;
		vault.set(name, secret);
		audit(`ADD ${name} ${kind}`);
		return `Salvato ${name} (${kind}). Nei comandi: {{secret:${name}${kind === "login" ? ".password" : ""}}}`;
	};

	const reply = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });
	pi.registerTool({
		name: "secret",
		label: "Secret",
		description:
			"Private credentials the user stored; values are never shown to you. action list: names, kinds and bound hosts. " +
			"action run {command}: runs a shell command with {{secret:name}} (login: .user/.password/.url) filled in; `sudo ...` gets the stored sudo password after the user confirms. " +
			"action add {name, kind}: opens masked dialogs so the USER types the values (you never see them); use it when the user wants to save a login/token/password, or a needed secret is missing. Output is scrubbed.",
		parameters: {
			type: "object",
			properties: { action: { type: "string", enum: ["list", "run", "add"] }, command: { type: "string" }, name: { type: "string" }, kind: { type: "string", enum: ["var", "login", "sudo"] } },
			required: ["action"],
		} as never,
		defaultActive: false,
		async execute(id, raw, signal, _update, ctx) {
			const params = raw as { action: string; command?: string; name?: string; kind?: string };
			if (params.action === "add") return reply(params.name ? await askAndSave(params.name, params.kind, ctx) : "Uso: action add {name, kind}.");
			if (params.action === "list") {
				if (vault.exists && !vault.unlocked) { const err = await ensureUnlocked(ctx); if (err) return reply(err); }
				if (!vault.unlocked) return reply("Nessun segreto salvato. L'utente può aggiungerne con /secret add NOME.");
				return reply(vault.names().map((n) => { const s = vault.get(n)!; const host = "url" in s && s.url ? ` → ${s.url}` : ""; return `${n} (${s.kind})${host}`; }).join("\n") || "Nessun segreto.");
			}
			if (params.action !== "run" || !params.command) return reply("Uso: action list | run {command} | add {name, kind}.");
			const r = await prepare(params.command, id, ctx);
			try {
				if ("block" in r) return reply(`Bloccato: ${r.block}`);
				const out = await new Promise<string>((resolve) => {
					execFile("bash", ["-c", r.command], { cwd: ctx.cwd, timeout: 120_000, maxBuffer: 1 << 20, signal, env: process.env }, (error, stdout, stderr) => {
						const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
						resolve(`${stdout}${stderr}${code ? `\nexit=${code}` : ""}`.slice(-20_000));
					});
				});
				const hits = scrub(out, vault.values());
				if (hits.hits.length) audit(`SCRUBBED ${hits.hits.join(",")} in secret`);
				return reply(hits.text || "(nessun output)");
			} finally {
				releases.get(id)?.();
				releases.delete(id);
			}
		},
	});

	pi.on("tool_result", (event) => {
		releases.get(event.toolCallId)?.();
		releases.delete(event.toolCallId);
		if (!vault.unlocked || !Array.isArray(event.content)) return undefined;
		const secrets = vault.values();
		let changed = false;
		const content = event.content.map((part) => {
			if (part.type !== "text") return part;
			const r = scrub(part.text, secrets);
			if (!r.hits.length) return part;
			changed = true;
			audit(`SCRUBBED ${r.hits.join(",")} in ${event.toolName}`);
			return { ...part, text: r.text };
		});
		return changed ? { content } : undefined;
	});

	pi.registerCommand("secret", {
		description: "Segreti: /secret add NOME [var|login|sudo] | list | rm NOME | lock",
		handler: async (args, ctx) => {
			const [cmd, name, k] = args.trim().split(/\s+/);
			if (cmd === "lock") { vault.lock(); ctx.ui.notify("Archivio dei segreti bloccato.", "info"); return; }
			if (cmd === "list" || !cmd) {
				const err = vault.unlocked || !vault.exists ? undefined : await ensureUnlocked(ctx);
				if (err) { ctx.ui.notify(err, "warning"); return; }
				const names = vault.unlocked ? vault.names() : peekNames();
				ctx.ui.notify(names.length ? names.map((n) => `${n} (${vault.get(n)?.kind ?? "?"})`).join("\n") : "Nessun segreto. /secret add NOME", "info");
				return;
			}
			if (cmd !== "add" && cmd !== "rm") { ctx.ui.notify("Uso: /secret add NOME [var|login|sudo] | list | rm NOME | lock", "info"); return; }
			if (!name || !NAME_RE.test(name)) { ctx.ui.notify("Nome non valido: lettere, cifre, _ e -, deve iniziare con una lettera.", "warning"); return; }
			const err = await ensureUnlocked(ctx);
			if (err) { ctx.ui.notify(err, "warning"); return; }
			if (cmd === "rm") { audit(`RM ${name}`); ctx.ui.notify(vault.remove(name) ? `Rimosso ${name}.` : `${name}: non esiste.`, "info"); return; }
			const res = await askAndSave(name, k, ctx);
			ctx.ui.notify(res, "info");
		},
	});

	pi.on("session_shutdown", () => { vault.lock(); askpass?.close(); });
}
