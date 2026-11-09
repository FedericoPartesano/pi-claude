/**
 * Auto mode policy, enforced in code inside the child `pi` (auto-worker.ts): a denylist for bash commands,
 * write limits for write/edit, and the per-command sandbox (bwrap where present, else `unshare -rn` when the
 * network must be off). See docs/adr/0001-auto-mode-processo-figlio-per-passo.md.
 */
import { isAbsolute, relative, resolve } from "node:path";

export const PHASES = ["define", "plan", "build", "verify", "review", "ship"] as const;
export type Phase = (typeof PHASES)[number];

/** From build on the network is off: web text never reaches a command once code is being written. */
export function networkAllowed(phase: Phase): boolean {
	return phase === "define" || phase === "plan";
}

const APPROVAL = "azione irreversibile o costosa: scrivila in auto/da-approvare.md e prosegui con il lavoro indipendente";

// Each rule: pattern on the whole command, reason shown to the model. Derived from Claude Code auto mode's
// soft_deny rules, narrowed to what a coding step on a branch never needs.
const ALWAYS: [RegExp, string][] = [
	[/(^|[\s;&|(])(sudo|su|doas|pkexec)\s/, "privilegi di root vietati"],
	[/(^|[\s;&|(])(mkfs|fdisk|parted|shutdown|reboot|halt|poweroff)\b|\bdd\s+[^;&|\n]*\bof=/, "comando di sistema distruttivo vietato"],
	[/\b(curl|wget)\b[^;&\n]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, "eseguire codice scaricato è vietato"],
	[/\b(npm|pnpm|yarn|bun)\s+(i|install|add)\s+[^-\s]/, `dipendenza nuova: ${APPROVAL}`],
	[/\b(pip3?|uv\s+pip|pipx|cargo|go|gem)\s+(install|add|get)\b/, `dipendenza nuova: ${APPROVAL}`],
	[/(^|[\s;&|(])(apt|apt-get|dnf|yum|brew|pacman|snap|choco|winget)\s/, `pacchetti di sistema: ${APPROVAL}`],
	[/\b(chmod|chown)\s+-R\b/, "chmod/chown ricorsivo vietato"],
	[/(^|[\s;&|(])(gh|glab)\s+(pr|release|repo|api)\b/, `operazione sul remoto: ${APPROVAL}`],
	[/(^|[\s;&|(])(crontab|systemctl|launchctl|schtasks)\b/, "servizi e attività pianificate vietati"],
	[/(^|[\s;&|(])(pkill|killall)\s|\bkill\s+(-\S+\s+)*-1\b/, "kill per nome o di tutti i processi vietato: usa kill <pid>"],
];

const GIT_DENY: Record<string, string> = {
	push: `git push: ${APPROVAL}`,
	"update-ref": "riscrittura dei ref vietata in auto mode",
	"symbolic-ref": "riscrittura dei ref vietata in auto mode",
	"filter-branch": "riscrittura della storia vietata",
	"filter-repo": "riscrittura della storia vietata",
	replace: "riscrittura dei ref vietata in auto mode",
	switch: "si lavora solo sul branch auto",
	worktree: "worktree gestiti dal supervisore",
	merge: "merge vietato: l'integrazione la decide l'utente",
	rebase: "rebase vietato in auto mode",
	"cherry-pick": "cherry-pick vietato in auto mode",
	pull: "operazioni sul remoto vietate",
	fetch: "operazioni sul remoto vietate",
	clone: "operazioni sul remoto vietate",
	remote: "operazioni sul remoto vietate",
};

/** git subcommands are read word by word: a commit message saying "merge" or "push" is not a merge. */
function gitDenyReason(command: string): string | undefined {
	for (const segment of command.split(/&&|\|\||[;|\n]/)) {
		const match = /(?:^|[\s(`])git\s+(.*)$/.exec(segment);
		if (!match) continue;
		const words = match[1].trim().split(/\s+/);
		let index = 0;
		while (index < words.length && words[index].startsWith("-")) {
			if (/^(-C|--git-dir|--work-tree)(=|$)/.test(words[index])) return "git -C/--git-dir/--work-tree vietato: si lavora solo nel worktree";
			if (words[index] === "-c") index++;
			index++;
		}
		const sub = words[index];
		const rest = words.slice(index + 1);
		if (!sub) continue;
		if (GIT_DENY[sub]) return GIT_DENY[sub];
		if (sub === "branch" && rest.some((word) => /^-[a-zA-Z]*[fDdmMcC]/.test(word) || /^--(force|delete|move|copy)$/.test(word))) return "git branch -f/-d/-m vietato: si lavora solo sul branch auto";
		if (sub === "checkout" && rest.some((word) => /^(-[bB]|--orphan)$/.test(word))) return "nuovi branch vietati: si lavora solo sul branch auto";
		if (sub === "reset" && rest.includes("--hard") && rest.some((word) => !word.startsWith("-") && !/^HEAD([~^]\d*)*$/.test(word))) return "reset --hard solo su HEAD";
		if (sub === "reflog" && rest[0] === "expire") return "cancellazione della storia git vietata";
		if (sub === "gc" && rest.some((word) => word.startsWith("--prune"))) return "cancellazione della storia git vietata";
	}
	return undefined;
}

const NETWORK = /(^|[\s;&|(])(curl|wget|ssh|scp|sftp|rsync|nc|ncat|telnet|ftp)\s|\/dev\/(tcp|udp)\//;

/** Paths an `rm`/`mv`/redirect may touch outside the worktree. */
const SCRATCH = ["/tmp/", "/dev/null"];

function inside(path: string, root: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Absolute or home paths used as targets by destructive commands (rm, mv, cp, truncate, >). */
function outsideTargets(command: string, worktree: string): string[] {
	const out: string[] = [];
	const destructive = /(^|[\s;&|(])(rm|rmdir|mv|cp|truncate|shred|unlink|ln|tee|install)\s([^;&|\n]*)/g;
	const redirect = />{1,2}\s*([^\s;&|]+)/g;
	const candidates: string[] = [];
	for (const match of command.matchAll(destructive)) candidates.push(...match[3].split(/\s+/));
	for (const match of command.matchAll(redirect)) candidates.push(match[1]);
	for (const raw of candidates) {
		const token = raw.replace(/^['"]|['"]$/g, "");
		if (!/^(\/|~|\$HOME|\$\{HOME\})/.test(token)) continue;
		if (SCRATCH.some((prefix) => token === prefix.replace(/\/$/, "") || token.startsWith(prefix))) continue;
		if (token.startsWith("/") && inside(resolve(token), worktree)) continue;
		out.push(token);
	}
	return out;
}

/** Why a bash command must not run in this phase, or undefined. */
export function denyReason(command: string, phase: Phase, worktree: string): string | undefined {
	for (const [pattern, reason] of ALWAYS) if (pattern.test(command)) return reason;
	const git = gitDenyReason(command);
	if (git) return git;
	if (!networkAllowed(phase) && NETWORK.test(command)) return `rete spenta nella fase ${phase}: niente download né connessioni`;
	const targets = outsideTargets(command, worktree);
	if (targets.length) return `scrittura fuori dal worktree vietata (${targets.slice(0, 3).join(", ")})`;
	return undefined;
}

/** Why write/edit must not touch this path, or undefined. `frozen` are worktree-relative paths. */
export function writeDenyReason(path: string, worktree: string, frozen: readonly string[]): string | undefined {
	const target = resolve(worktree, path);
	if (!inside(target, worktree)) return "scrittura fuori dal worktree vietata";
	const rel = relative(worktree, target);
	if (rel === ".git" || rel.startsWith(".git/")) return "scrittura in .git vietata";
	if (frozen.includes(rel)) return `${rel} è congelato dopo il piano: i check e i test del piano non si modificano`;
	return undefined;
}

const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

export interface SandboxOptions {
	worktree: string;
	/** Shared git dir of the main repo (objects and refs of the worktree live there). */
	gitDir: string;
	network: boolean;
	/** Absolute paths kept read-only even inside the worktree. */
	readOnly: readonly string[];
	bwrap: boolean;
	unshare: boolean;
}

/**
 * The command as it must really run. bwrap: whole filesystem read-only except the worktree, the git dir and
 * /tmp, frozen files read-only, network off when asked (0.04 s per command, measured M5). Without bwrap the
 * filesystem rests on the denylist; the network still goes off through `unshare -rn` when available.
 */
export function sandboxCommand(command: string, options: SandboxOptions): string {
	if (options.bwrap) {
		const args = ["bwrap", "--die-with-parent", "--unshare-pid", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--bind", "/tmp", "/tmp"];
		args.push("--bind", options.worktree, options.worktree, "--bind", options.gitDir, options.gitDir);
		for (const path of options.readOnly) args.push("--ro-bind", path, path);
		if (!options.network) args.push("--unshare-net");
		return `${args.map((arg) => (/^[\w./=-]+$/.test(arg) ? arg : quote(arg))).join(" ")} bash -c ${quote(command)}`;
	}
	if (!options.network && options.unshare) return `unshare -rn bash -c ${quote(command)}`;
	return command;
}
