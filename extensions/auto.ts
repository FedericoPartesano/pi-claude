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
import { appendEvent, diaryFile, readDiary, type DiaryEvent } from "./auto/diary.ts";
import { killAllChildren, runChild } from "./auto/child.ts";
import { docsDir, docsStatus } from "./auto/docs.ts";
import { panelLines, runAuto, type LoopDeps } from "./auto/loop.ts";
import { sandboxCommand } from "./auto/policy.ts";
import { DECISIONS_FILE, loadState, newState, saveState, stateFile, type AutoState } from "./auto/state.ts";
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
	/** Wakes the loop waiting in the pause gate (resume or stop). */
	wake?: () => void;
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_AUTO_PHASE || process.env.PI_TEAM_CHILD) return;
	let current: Run | undefined;
	const bwrap = process.platform === "linux" && has("bwrap", ["--ro-bind", "/", "/", "true"]);
	const unshare = process.platform === "linux" && has("unshare", ["-rn", "true"]);

	// The `auto` tool is a name in the tool list only while a run exists: no fixed prompt cost otherwise.
	const setTool = (on: boolean) => {
		try {
			const others = pi.getActiveTools().filter((name) => name !== "auto");
			pi.setActiveTools(on ? [...others, "auto"] : others);
		} catch (error) {
			if (!/stale/i.test(String((error as Error)?.message))) throw error;
		}
	};
	pi.registerTool({
		name: "auto",
		label: "Auto",
		description:
			"Read and steer the running /auto run (the user's autonomous goal). action: status (phase, requirements, last tools) · nota {text: reaches the next step's prompt} · pausa · riprendi · stop. " +
			"Use only when the user asks about or wants to steer the run; never start or stop it on your own.",
		parameters: {
			type: "object",
			properties: { action: { type: "string", enum: ["status", "nota", "pausa", "riprendi", "stop"] }, text: { type: "string" } },
			required: ["action"],
		} as never,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { action, text = "" } = params as { action: string; text?: string };
			const reply = act(action, text, ctx as unknown as ExtensionCommandContext);
			return { content: [{ type: "text" as const, text: reply.text }], details: undefined };
		},
	});
	pi.on("session_start", () => setTool(!!current));

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
	// Side panel of the prototype chat (RPC): a few plain lines, rebuilt on loop events only. The classic TUI would show
	// a widget above the editor, so there the status line stays the only sign.
	const panel = (ctx: ExtensionCommandContext, state: AutoState | undefined, line?: string) => {
		try {
			if (ctx.hasUI && ctx.mode === "rpc") ctx.ui.setWidget("auto", state ? panelLines(state, readUsage(), line) : undefined);
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

	/** A guidance command: diary line plus a line in auto/decisioni.md, so the run can be understood afterwards. */
	function guide(run: Run, event: DiaryEvent): void {
		appendEvent(diaryFile(run.file), event);
		if (event.t !== "cmd") return;
		try {
			const file = join(run.state.worktree, DECISIONS_FILE);
			mkdirSync(dirname(file), { recursive: true });
			appendFileSync(file, `- guida dell'utente: ${event.cmd}${event.text ? ` «${event.text}»` : ""} — chiesto con /auto\n`);
		} catch {}
	}

	const GUIDE_WORDS = new Set(["stop", "pausa", "riprendi", "nota"]);
	/** One entry point for the command and the tool: status, stop, pausa, riprendi, nota. Returns the reply text. */
	function act(word: string, arg: string, ctx: ExtensionCommandContext): { text: string; warn?: boolean } {
		const run = current;
		if (!run) return { text: "auto: nessun lavoro in corso. Uso: /auto <goal> · /auto resume [slug]" };
		const s = run.state;
		if (word === "stop") {
			guide(run, { t: "cmd", at: Date.now(), cmd: "stop", applied: true });
			run.controller.abort();
			run.wake?.();
			return { text: `auto ${s.slug}: fermo il passo in corso…` };
		}
		if (word === "pausa" || word === "riprendi") {
			const pause = word === "pausa";
			s.paused = pause;
			saveState(run.file, s);
			guide(run, { t: "cmd", at: Date.now(), cmd: word, applied: !pause });
			panel(ctx, s);
			if (!pause) run.wake?.();
			return { text: pause ? `auto ${s.slug}: in pausa al prossimo confine di passo (riprendi con riprendi).` : `auto ${s.slug}: riprendo.` };
		}
		if (word === "nota") {
			const text = arg.trim().slice(0, 500);
			if (!text) return { text: "auto: uso /auto nota <testo>", warn: true };
			(s.notes ??= []).push(text);
			saveState(run.file, s);
			guide(run, { t: "cmd", at: Date.now(), cmd: "nota", text, applied: false });
			return { text: `auto ${s.slug}: nota in coda, entra nel prossimo passo.` };
		}
		const done = s.requirements.filter((item) => item.passes).length;
		const open = s.requirements.filter((item) => !item.passes).slice(0, 5).map((item) => `  ○ ${item.id} ${item.descrizione}`.slice(0, 120));
		const tools = readDiary(diaryFile(run.file)).filter((e) => e.t === "tool").slice(-5).map((e) => `  ▸ ${e.name} ${e.arg}`.slice(0, 120));
		return {
			text: [
				`auto ${s.slug} · fase ${s.phase}${s.paused ? " · IN PAUSA" : ""} · ${done}/${s.requirements.length} requisiti · passo ${s.steps} · ${s.tokens} token`,
				...(open.length ? ["Requisiti aperti:", ...open] : []),
				...(tools.length ? ["Ultimi tool del figlio:", ...tools] : []),
				...(s.notes?.length ? [`Note in coda: ${s.notes.length}`] : []),
				...s.log.slice(-8),
			].join("\n"),
		};
	}

	function launch(ctx: ExtensionCommandContext, state: AutoState, file: string, gitDir: string): void {
		const controller = new AbortController();
		const run: Run = { state, controller, file };
		current = run;
		setTool(true);
		const diary = diaryFile(file);
		const deps: LoopDeps = {
			step: (s, request) => runChild(s, request, { gitDir, skillsDir: SKILLS_DIR, onTool: (name, arg) => appendEvent(diary, { t: "tool", at: Date.now(), n: s.steps, name, arg }), onSay: (kind, text) => appendEvent(diary, { t: "say", at: Date.now(), n: s.steps, kind, text }) }, controller.signal),
			event: (event) => appendEvent(diary, event),
			gate: async (s) => {
				if (s.paused && !controller.signal.aborted) appendEvent(diary, { t: "cmd", at: Date.now(), cmd: "pausa", applied: true });
				while (s.paused && !controller.signal.aborted) await new Promise<void>((resolve) => (run.wake = resolve));
				run.wake = undefined;
			},
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
				panel(ctx, s, line);
				if (/^stop:|verde|^piano:/.test(line)) tell(ctx, `auto ${s.slug}: ${line}`);
			},
		};
		status(ctx, `auto ${state.phase} · avvio`);
		panel(ctx, state, "avvio");
		// The cockpit of the prototype reads the state file and the diary from disk: only the path travels over RPC.
		try {
			if (ctx.hasUI && ctx.mode === "rpc") ctx.ui.setStatus("auto-run", file);
		} catch {}
		runAuto(state, deps)
			.then((final) => {
				const reason = final.stop?.reason ?? "?";
				panel(ctx, final); // the outcome stays in the panel until the next /auto
				const approvals = join(final.worktree, "auto/da-approvare.md");
				const drafts = docsStatus(final.worktree).bozza.map((doc) => doc.file);
				const extra = `${existsSync(approvals) && statSync(approvals).size > 0 ? `\nDa approvare: ${approvals}` : ""}${drafts.length ? `\nBozze da rivedere in ${join(final.worktree, docsDir(final.worktree))}: ${drafts.join(", ")} (togli \`stato: bozza\` quando vanno bene)` : ""}`;
				tell(
					ctx,
					`auto ${final.slug}: ${reason} — ${final.stop?.detail ?? ""}\nBranch ${final.branch} in ${final.worktree} · ${final.steps} passi · ${final.tokens} token${extra}\n${
						reason === "completato"
							? "Rivedi il branch e integralo con /land dal worktree."
								: "Riprendi con /auto resume " + final.slug
					}`,
					reason === "completato" ? "info" : "warning",
				);
			})
			.catch((error) => tell(ctx, `auto: errore del supervisore: ${(error as Error).message}`, "error"))
			.finally(() => {
				if (current === run) { current = undefined; setTool(false); }
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
		state.paused = false; // a run stopped while paused must not wait for a resume that already happened
		state.deadline = Math.max(state.deadline, Date.now() + HOURS * 3_600_000);
		state.fiveHourStart = readUsage();
		linkNodeModules(state.repo, state.worktree);
		tell(ctx, `auto ${state.slug}: riprendo dalla fase ${state.phase} (passo ${state.steps}).`);
		launch(ctx, state, stateFile(info.home, state.slug), info.gitDir);
	}

	pi.registerCommand("auto", {
		description: "Porta a termine un goal in autonomia su un branch auto/<slug> in un worktree (/auto <goal> | resume | stop | status | pausa | riprendi | nota <testo>)",
		handler: async (args, ctx) => {
			const text = args.trim();
			const [word, ...rest] = text.split(/\s+/);
			if (GUIDE_WORDS.has(word) || word === "status" || !text) {
				const reply = act(word || "status", rest.join(" "), ctx);
				return tell(ctx, reply.text, reply.warn ? "warning" : "info");
			}
			if (current) return tell(ctx, `auto: è già in corso ${current.state.slug} (/auto stop per fermarlo).`, "warning");
			if (word === "resume") return resume(rest.join(" "), ctx);
			return start(text, ctx);
		},
	});
}
