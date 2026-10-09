/**
 * Test-gated landing for branches worked on in parallel (several Pi / Claude Code sessions, each in its own git
 * worktree), after claude-mods' landing queue: one session at a time (a lock in the shared git dir is the queue),
 * rebase onto the target, run the checks, fast-forward the target only when they pass. A conflict or a red check
 * puts the branch back exactly as it was (one-shot revert): nothing half-landed, nothing lost. A checkout of the
 * target with uncommitted work is never touched.
 */
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface LandOptions {
	cwd: string;
	onto: string;
	checks: string[];
	signal?: AbortSignal;
	onProgress?: (line: string) => void;
	/** How long to wait in the queue behind another session (default 30 min). */
	queueWaitMs?: number;
}

export interface LandResult {
	ok: boolean;
	message: string;
}

const CHECK_TIMEOUT_MS = 15 * 60 * 1000;
const STALE_MS = 2 * 60 * 60 * 1000;
/** A lock directory still without its owner file after this long was left by a crash between mkdir and write. */
const ORPHAN_MS = 60 * 1000;

function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
	return new Promise((done) =>
		execFile("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => done({ ok: !error, out: `${stdout}${error ? stderr : ""}`.trim() })),
	);
}

function check(command: string, cwd: string, signal?: AbortSignal): Promise<{ ok: boolean; output: string }> {
	return new Promise((done) => {
		const child = spawn("bash", ["-c", command], { cwd, signal, timeout: CHECK_TIMEOUT_MS });
		let output = "";
		const collect = (chunk: Buffer) => {
			output = (output + chunk.toString()).slice(-3000);
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
		child.on("error", (error) => done({ ok: false, output: `${output}\n${error.message}` }));
		child.on("close", (code) => done({ ok: code === 0, output }));
	});
}

/** `npm test` when package.json has a real test script; otherwise no default (the user passes --check). */
export function defaultChecks(dir: string): string[] {
	try {
		const test = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { scripts?: { test?: string } }).scripts?.test;
		return test && !/no test specified/.test(test) ? ["npm test"] : [];
	} catch {
		return [];
	}
}

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
};

function readOwner(dir: string): { cwd?: string; stale: boolean } {
	let owner: { pid?: number; at?: number; cwd?: string } = {};
	let age = 0;
	try {
		age = Date.now() - statSync(dir).mtimeMs;
		owner = JSON.parse(readFileSync(join(dir, "owner.json"), "utf8"));
	} catch {
		// Gone, being written right now, or left without an owner file.
	}
	return { cwd: owner.cwd, stale: owner.pid !== undefined ? !alive(owner.pid) || Date.now() - (owner.at ?? 0) > STALE_MS : age > ORPHAN_MS };
}

/**
 * Removes a stale lock under a second, short-lived lock, re-checking staleness while holding it: of several waiters
 * that saw the same dead owner, one removes it and the others then find a live owner (or a free slot).
 */
function takeOver(dir: string): boolean {
	const mutex = `${dir}.takeover`;
	try {
		mkdirSync(mutex);
	} catch {
		try {
			if (Date.now() - statSync(mutex).mtimeMs > 10_000) rmSync(mutex, { recursive: true, force: true }); // left by a crash
		} catch {
			// Released meanwhile.
		}
		return false;
	}
	try {
		if (readOwner(dir).stale) rmSync(dir, { recursive: true, force: true });
		return true;
	} finally {
		rmSync(mutex, { recursive: true, force: true });
	}
}

/** The queue: a directory in the git dir shared by all worktrees (mkdir is atomic). A dead or stale owner's lock is taken over. */
export async function acquireLandLock(cwd: string, options: { pollMs?: number; waitMs?: number; onWait?: (owner: string) => void; signal?: AbortSignal } = {}): Promise<{ release: () => void } | undefined> {
	const common = await git(cwd, ["rev-parse", "--git-common-dir"]);
	if (!common.ok) return undefined;
	const dir = resolve(cwd, common.out, "pi-land.lock");
	const deadline = Date.now() + (options.waitMs ?? 30 * 60 * 1000);
	let told = false;
	while (!options.signal?.aborted) {
		try {
			mkdirSync(dir);
			const token = randomUUID();
			writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: process.pid, at: Date.now(), cwd, token }));
			return {
				// Only our own lock: never one another session took over after we were declared stale.
				release: () => {
					try {
						if ((JSON.parse(readFileSync(join(dir, "owner.json"), "utf8")) as { token?: string }).token === token) rmSync(dir, { recursive: true, force: true });
					} catch {
						// Already gone.
					}
				},
			};
		} catch {
			const owner = readOwner(dir);
			if (owner.stale && takeOver(dir)) continue;
			if (!told) options.onWait?.(owner.cwd ?? "un'altra sessione");
			told = true;
			if (Date.now() > deadline) return undefined;
			await new Promise((wake) => setTimeout(wake, options.pollMs ?? 1000));
		}
	}
	return undefined;
}

/** The worktree where `branch` is checked out, if any. */
async function checkoutOf(cwd: string, branch: string): Promise<string | undefined> {
	const list = await git(cwd, ["worktree", "list", "--porcelain"]);
	for (const block of list.out.split("\n\n")) {
		const path = /^worktree (.+)$/m.exec(block)?.[1];
		if (path && new RegExp(`^branch refs/heads/${branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(block)) return path;
	}
	return undefined;
}

export async function land(options: LandOptions): Promise<LandResult> {
	const { cwd, onto, checks, signal } = options;
	const say = (line: string) => options.onProgress?.(line);
	const branch = (await git(cwd, ["branch", "--show-current"])).out;
	if (!branch) return { ok: false, message: "Non sei su un branch (HEAD staccato): /land integra il branch corrente." };
	if (branch === onto) return { ok: false, message: `Sei già su ${onto}: /land si lancia dal branch da integrare (di solito in una worktree).` };
	if (!(await git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${onto}`])).ok) return { ok: false, message: `Il branch ${onto} non esiste.` };
	if ((await git(cwd, ["status", "--porcelain", "--untracked-files=no"])).out) return { ok: false, message: "Ci sono modifiche non committate: committale (o mettile da parte) prima di integrare." };

	const lock = await acquireLandLock(cwd, { signal, waitMs: options.queueWaitMs, onWait: (owner) => say(`⏳ in coda: sta integrando ${owner}`) });
	if (!lock) return { ok: false, message: signal?.aborted ? "Interrotto." : "Coda bloccata da troppo tempo: un'altra integrazione è ancora in corso." };
	const before = (await git(cwd, ["rev-parse", "HEAD"])).out;
	const putBack = async () => {
		// --keep, not --hard: anything edited meanwhile (checks can take minutes) stops the reset instead of being lost.
		if ((await git(cwd, ["rev-parse", "HEAD"])).out !== before) await git(cwd, ["reset", "-q", "--keep", before]);
	};
	try {
		const target = (await git(cwd, ["rev-parse", onto])).out;
		if (!(await git(cwd, ["merge-base", "--is-ancestor", target, "HEAD"])).ok) {
			say(`↻ rebase di ${branch} su ${onto}`);
			const rebased = await git(cwd, ["rebase", "-q", onto]);
			if (!rebased.ok) {
				const conflicts = (await git(cwd, ["diff", "--name-only", "--diff-filter=U"])).out.split("\n").filter(Boolean);
				await git(cwd, ["rebase", "--abort"]);
				await putBack();
				return { ok: false, message: `Conflitto col lavoro già su ${onto}${conflicts.length ? ` in: ${conflicts.join(", ")}` : `: ${rebased.out.split("\n").pop()}`}. ${branch} è rimasto com'era: risolvi (git rebase ${onto}) e rilancia /land.` };
			}
		}
		for (const command of checks) {
			say(`▶ controllo: ${command}`);
			const result = await check(command, cwd, signal);
			if (!result.ok) {
				await putBack();
				return { ok: false, message: `Il controllo \`${command}\` fallisce dopo il rebase su ${onto}: niente integrato, ${branch} rimesso com'era.\n${result.output.trim().split("\n").slice(-15).join("\n")}` };
			}
		}
		const head = (await git(cwd, ["rev-parse", "HEAD"])).out;
		const live = await checkoutOf(cwd, onto);
		if (live) {
			if ((await git(live, ["status", "--porcelain", "--untracked-files=no"])).out) return { ok: false, message: `${live} (su ${onto}) ha modifiche non committate: non lo tocco. ${branch} è rebasato e verde: integra quando quel checkout è pulito.` };
			const merged = await git(live, ["merge", "-q", "--ff-only", head]);
			if (!merged.ok) return { ok: false, message: `${onto} si è mosso durante i controlli (${merged.out.split("\n").pop()}): rilancia /land.` };
		} else {
			const moved = await git(cwd, ["update-ref", `refs/heads/${onto}`, head, target]);
			if (!moved.ok) return { ok: false, message: `${onto} si è mosso durante i controlli: rilancia /land.` };
		}
		const count = (await git(cwd, ["rev-list", "--count", `${target}..${head}`])).out;
		return { ok: true, message: `✓ ${branch} integrato in ${onto} (${count} commit${checks.length ? `, ${checks.length} controlli verdi` : ", nessun controllo"})${live ? ` · ${live} aggiornato` : ""}` };
	} finally {
		lock.release();
	}
}
