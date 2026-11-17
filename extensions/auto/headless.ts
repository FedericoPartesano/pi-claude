/**
 * /auto without a Pi session: the same supervisor loop (loop.ts) started from code, for callers that have no
 * ExtensionCommandContext (the Paperclip adapter, auto/paperclip.ts). Same worktree layout, same state file,
 * same guards as the command; an existing state for the slug is resumed (progress re-read from the checks).
 * Never pushes or merges.
 */
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { git, has, ignoreLinks, linkNodeModules, readUsage } from "../auto.ts";
import { runCheck } from "../goal.ts";
import { appendEvent, diaryFile } from "./diary.ts";
import { runAuto, type LoopDeps } from "./loop.ts";
import { sandboxCommand } from "./policy.ts";
import { loadState, newState, saveState, stateFile, type AutoState } from "./state.ts";
import { stepWithTeam } from "./team.ts";

const SKILLS_DIR = fileURLToPath(new URL("../../skills", import.meta.url));
const HOURS = Number(process.env.PI_AUTO_HOURS ?? 3);

export interface HeadlessOptions {
	cwd: string;
	goal: string;
	/** Stable id of the job (Paperclip issue): same slug = resume. */
	slug: string;
	signal?: AbortSignal;
	onLine?: (line: string) => void;
	/** Replaces the whole loop (tests). */
	run?: (state: AutoState, deps: LoopDeps) => Promise<AutoState>;
	/** Replaces the step (tests); the default is a child per step, or the team. */
	step?: LoopDeps["step"];
}

export async function runHeadless(options: HeadlessOptions): Promise<AutoState> {
	const { cwd, goal, slug } = options;
	const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
	const common = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
	if (!top.ok || !common.ok) throw new Error("serve un repository git");
	const gitDir = common.out.trim();
	const repo = basename(gitDir) === ".git" ? dirname(gitDir) : top.out.trim();
	const home = join(dirname(repo), `${basename(repo)}-auto`);
	const file = stateFile(home, slug);
	let state = loadState(file);
	if (state && !existsSync(state.worktree)) throw new Error(`il worktree ${state.worktree} non esiste più`);
	if (state) {
		state.stall = 0;
		state.sameError = 0;
		state.paused = false;
		state.stop = undefined;
		state.deadline = Math.max(state.deadline, Date.now() + HOURS * 3_600_000);
	} else {
		const branch = `auto/${slug}`;
		const worktree = join(home, slug);
		const base = (await git(repo, ["rev-parse", "HEAD"])).out.trim();
		if (!base) throw new Error("il repository non ha commit");
		mkdirSync(home, { recursive: true });
		const added = await git(repo, ["worktree", "add", "-q", "-b", branch, worktree, base]);
		if (!added.ok) throw new Error(`worktree non creato: ${added.out.trim().slice(-300)}`);
		const started = Date.now();
		state = newState({ goal, slug, branch, repo, worktree, base, intent: `intents/${new Date(started).toISOString().slice(0, 10)}-${slug}.md`, started, deadline: started + HOURS * 3_600_000 });
	}
	state.fiveHourStart = readUsage();
	ignoreLinks(gitDir);
	linkNodeModules(repo, state.worktree);
	saveState(file, state);

	const controller = new AbortController();
	options.signal?.addEventListener("abort", () => controller.abort(), { once: true });
	const bwrap = process.platform === "linux" && has("bwrap", ["--ro-bind", "/", "/", "true"]);
	const unshare = process.platform === "linux" && has("unshare", ["-rn", "true"]);
	const diary = diaryFile(file);
	const check: LoopDeps["check"] = (command, dir) => runCheck(sandboxCommand(command, { worktree: dir, gitDir, network: false, readOnly: [], bwrap, unshare }), dir, controller.signal);
	const env = {
		gitDir,
		skillsDir: SKILLS_DIR,
		onTool: (name: string, arg: string) => appendEvent(diary, { t: "tool", at: Date.now(), n: state!.steps, name, arg }),
		onSay: (kind: "think" | "text", text: string) => appendEvent(diary, { t: "say", at: Date.now(), n: state!.steps, kind, text }),
	};
	const deps: LoopDeps = {
		step: options.step ?? stepWithTeam(env, check, controller.signal),
		event: (event) => appendEvent(diary, event),
		check,
		git,
		usage: readUsage,
		now: Date.now,
		save: (s) => saveState(file, s),
		stopped: () => controller.signal.aborted,
		progress: (_s, line) => options.onLine?.(line),
	};
	return (options.run ?? runAuto)(state, deps);
}

