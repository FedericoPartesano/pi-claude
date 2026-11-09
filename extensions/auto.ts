/**
 * /auto: Pi carries a goal through define → plan → build → verify → review → ship on its own, on branch
 * `auto/<slug>` in a git worktree next to the repo (`<repo>-auto/<slug>`). This extension is only the
 * supervisor: code, no tool, no prompt text (0 tokens at rest). Every step is a child `pi` (auto/child.ts),
 * guarded by auto-worker.ts. Never pushes or merges. Decision: docs/adr/0001-auto-mode-processo-figlio-per-passo.md.
 *
 *   /auto <goal>         start
 *   /auto resume [slug]  resume a stopped run (progress re-read from the checks: idempotent)
 *   /auto stop           stop the running step and the loop
 *   /auto status         where the run is
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { killAllChildren, runChild } from "./auto/child.ts";
import { runAuto, type LoopDeps } from "./auto/loop.ts";
import { sandboxCommand } from "./auto/policy.ts";
import { loadState, newState, saveState, stateFile, type AutoState } from "./auto/state.ts";
import { runCheck } from "./goal.ts";
import { slugify } from "./intent.ts";

const USAGE_FILE = join(homedir(), ".pi/agent/claude-code-usage.json");
const SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));
const HOURS = Number(process.env.PI_AUTO_HOURS ?? 3);

function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
	return new Promise((resolve) => execFile("git", args, { cwd, maxBuffer: 8 << 20 }, (error, stdout, stderr) => resolve({ ok: !error, out: error ? `${stdout}${stderr}` : stdout })));
}

function readUsage(): number | undefined {
	try {
		const value = JSON.parse(readFileSync(USAGE_FILE, "utf8")).fiveHourUtilization;
		return typeof value === "number" ? value : undefined;
	} catch {
		return undefined;
	}
}

const has = (binary: string, args: string[]) => {
	try {
		execFileSync(binary, args, { stdio: "ignore", timeout: 5000 });
		return true;
	} catch {
		return false;
	}
};

/** Links every node_modules of the repo (root and one level down) into the worktree: 0.92 s instead of reinstalls (R3). */
export function linkNodeModules(repo: string, worktree: string): number {
	let linked = 0;
	const link = (rel: string) => {
		const source = join(repo, rel, "node_modules");
		const target = join(worktree, rel, "node_modules");
		if (!existsSync(source) || existsSync(target) || !existsSync(join(worktree, rel))) return;
		symlinkSync(source, target, "dir");
		linked++;
	};
	link("");
	for (const entry of readdirSync(repo, { withFileTypes: true })) if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") link(entry.name);
	return linked;
}

/** A symlinked node_modules is a file to git: `node_modules/` in .gitignore does not hide it. */
function ignoreLinks(gitDir: string): void {
	const file = join(gitDir, "info", "exclude");
	const text = existsSync(file) ? readFileSync(file, "utf8") : "";
	if (/^node_modules$/m.test(text)) return;
	mkdirSync(dirname(file), { recursive: true });
	appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}# auto mode: symlinked node_modules in worktrees\nnode_modules\n`);
}

interface Run {
	state: AutoState;
	controller: AbortController;
	file: string;
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_AUTO_PHASE || process.env.PI_TEAM_CHILD) return;
	let current: Run | undefined;
	const bwrap = process.platform === "linux" && has("bwrap", ["--ro-bind", "/", "/", "true"]);
	const unshare = process.platform === "linux" && has("unshare", ["-rn", "true"]);

	pi.on("session_shutdown", () => {
		current?.controller.abort();
		killAllChildren();
	});

	const tell = (ctx: ExtensionCommandContext, text: string, level: "info" | "warning" | "error" = "info") => {
		try {
			if (ctx.hasUI) ctx.ui.notify(text, level);
			else console.error(text);
		} catch {}
	};
	const status = (ctx: ExtensionCommandContext, text: string | undefined) => {
		try {
			if (ctx.hasUI) ctx.ui.setStatus("auto", text);
		} catch {}
	};

	async function repoInfo(cwd: string): Promise<{ repo: string; gitDir: string; home: string } | undefined> {
		const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
		const common = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
		if (!top.ok || !common.ok) return undefined;
		let repo = top.out.trim();
		const gitDir = common.out.trim();
		// Launched from inside an auto worktree: the main repo owns the git dir.
		if (basename(gitDir) === ".git") repo = dirname(gitDir);
		return { repo, gitDir, home: join(dirname(repo), `${basename(repo)}-auto`) };
	}

	function launch(ctx: ExtensionCommandContext, state: AutoState, file: string, gitDir: string): void {
		const controller = new AbortController();
		const run: Run = { state, controller, file };
		current = run;
		const deps: LoopDeps = {
			step: (s, request) => runChild(s, request, { gitDir, skillsDir: SKILLS_DIR }, controller.signal),
			check: (command, cwd) =>
				runCheck(sandboxCommand(command, { worktree: cwd, gitDir, network: false, readOnly: [], bwrap, unshare }), cwd, controller.signal),
			git,
			usage: readUsage,
			now: Date.now,
			save: (s) => saveState(file, s),
			stopped: () => controller.signal.aborted,
			progress: (s, line) => {
				const done = s.requirements.filter((item) => item.passes).length;
				status(ctx, `auto ${s.phase}${s.requirements.length ? ` ${done}/${s.requirements.length}` : ""} · passo ${s.steps}`);
				if (/^stop:|verde|^piano:/.test(line)) tell(ctx, `auto ${s.slug}: ${line}`);
			},
		};
		status(ctx, `auto ${state.phase} · avvio`);
		runAuto(state, deps)
			.then((final) => {
				const reason = final.stop?.reason ?? "?";
				const approvals = join(final.worktree, "auto/da-approvare.md");
				const extra = existsSync(approvals) && statSync(approvals).size > 0 ? `\nDa approvare: ${approvals}` : "";
				tell(
					ctx,
					`auto ${final.slug}: ${reason} — ${final.stop?.detail ?? ""}\nBranch ${final.branch} in ${final.worktree} · ${final.steps} passi · ${final.tokens} token${extra}\n${reason === "completato" ? "Rivedi il branch e integralo con /land dal worktree." : "Riprendi con /auto resume " + final.slug}`,
					reason === "completato" ? "info" : "warning",
				);
			})
			.catch((error) => tell(ctx, `auto: errore del supervisore: ${(error as Error).message}`, "error"))
			.finally(() => {
				if (current === run) current = undefined;
				status(ctx, undefined);
			});
	}

	async function start(goal: string, ctx: ExtensionCommandContext): Promise<void> {
		const info = await repoInfo(ctx.cwd);
		if (!info) return tell(ctx, "auto: serve un repository git.", "error");
		const { repo, gitDir, home } = info;
		let slug = slugify(goal) || "goal";
		for (let n = 2; (await git(repo, ["rev-parse", "--verify", "-q", `refs/heads/auto/${slug}`])).ok || existsSync(join(home, slug)); n++) slug = `${slugify(goal) || "goal"}-${n}`.slice(0, 54);
		const branch = `auto/${slug}`;
		const worktree = join(home, slug);
		const base = (await git(repo, ["rev-parse", "HEAD"])).out.trim();
		if (!base) return tell(ctx, "auto: il repository non ha commit.", "error");
		mkdirSync(home, { recursive: true });
		const added = await git(repo, ["worktree", "add", "-q", "-b", branch, worktree, base]);
		if (!added.ok) return tell(ctx, `auto: worktree non creato: ${added.out.trim().slice(-300)}`, "error");
		ignoreLinks(gitDir);
		const linked = linkNodeModules(repo, worktree);
		const dirty = (await git(repo, ["status", "--porcelain"])).out.trim();
		const started = Date.now();
		const date = new Date(started).toISOString().slice(0, 10);
		const model = ctx.model?.provider === "claude-code" ? { provider: "claude-code", id: ctx.model.id } : undefined;
		const state = newState({ goal, slug, branch, repo, worktree, base, intent: `intents/${date}-${slug}.md`, started, deadline: started + HOURS * 3_600_000, fiveHourStart: readUsage(), model });
		const file = stateFile(home, slug);
		saveState(file, state);
		tell(
			ctx,
			`auto ${slug}: branch ${branch} in ${worktree} (${linked} node_modules collegati${bwrap ? ", sandbox bwrap" : unshare ? ", rete spenta con unshare" : ", senza sandbox: solo lista nera"}).${dirty ? "\nAttenzione: le modifiche non committate del repo non sono nel worktree." : ""}\n/auto stop per fermarlo, /auto status per lo stato.`,
		);
		launch(ctx, state, file, gitDir);
	}

	async function resume(slugArg: string, ctx: ExtensionCommandContext): Promise<void> {
		const info = await repoInfo(ctx.cwd);
		if (!info) return tell(ctx, "auto: serve un repository git.", "error");
		const candidates = existsSync(info.home)
			? readdirSync(info.home)
					.filter((name) => name.endsWith(".json"))
					.map((name) => loadState(join(info.home, name)))
					.filter((state): state is AutoState => !!state && state.stop?.reason !== "completato")
					.sort((a, b) => (b.stop?.at ?? b.started) - (a.stop?.at ?? a.started))
			: [];
		const state = slugArg ? candidates.find((item) => item.slug === slugArg) : candidates[0];
		if (!state) return tell(ctx, slugArg ? `auto: nessun lavoro da riprendere con slug ${slugArg}.` : "auto: nessun lavoro da riprendere.", "warning");
		if (!existsSync(state.worktree)) return tell(ctx, `auto: il worktree ${state.worktree} non esiste più.`, "error");
		state.stall = 0;
		state.sameError = 0;
		state.deadline = Math.max(state.deadline, Date.now() + HOURS * 3_600_000);
		state.fiveHourStart = readUsage();
		linkNodeModules(state.repo, state.worktree);
		tell(ctx, `auto ${state.slug}: riprendo dalla fase ${state.phase} (passo ${state.steps}).`);
		launch(ctx, state, stateFile(info.home, state.slug), info.gitDir);
	}

	pi.registerCommand("auto", {
		description: "Porta a termine un goal in autonomia su un branch auto/<slug> in un worktree (/auto <goal> | resume | stop | status)",
		handler: async (args, ctx) => {
			const text = args.trim();
			const [word, ...rest] = text.split(/\s+/);
			if (word === "stop") {
				if (!current) return tell(ctx, "auto: nessun lavoro in corso.");
				current.controller.abort();
				return tell(ctx, `auto ${current.state.slug}: fermo il passo in corso…`);
			}
			if (word === "status" || !text) {
				if (!current) return tell(ctx, "auto: nessun lavoro in corso. Uso: /auto <goal> · /auto resume [slug]");
				const s = current.state;
				const done = s.requirements.filter((item) => item.passes).length;
				return tell(ctx, [`auto ${s.slug} · fase ${s.phase} · ${done}/${s.requirements.length} requisiti · passo ${s.steps} · ${s.tokens} token`, ...s.log.slice(-8)].join("\n"));
			}
			if (current) return tell(ctx, `auto: è già in corso ${current.state.slug} (/auto stop per fermarlo).`, "warning");
			if (word === "resume") return resume(rest.join(" "), ctx);
			return start(text, ctx);
		},
	});
}
