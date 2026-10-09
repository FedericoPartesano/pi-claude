/**
 * Another session writing the same file right now (from claude-mods' peer-writer guard): several Pi and Claude Code
 * sessions on one checkout overwrite each other silently. A file is a peer's fresh work when it changed in the last
 * FRESH_MS, git sees it modified, and this session did not write it (with edit/write, or during one of its own bash
 * commands, e.g. a formatter). Warned once per change: after re-reading, the write goes through.
 */
export const FRESH_MS = 120_000;
/** Slack around our bash commands (file times are written a little after the command ends). */
const BASH_SLACK_MS = 2000;

export interface PeerIo {
	/** Modification time in ms, undefined when the file does not exist. */
	mtime(path: string): number | undefined;
	/** Whether git sees the file as modified or untracked (no repo: true). */
	dirty(path: string): boolean;
}

export class PeerGuard {
	private readonly io: PeerIo;
	/** Our last write per file (its mtime then). */
	private readonly own = new Map<string, number>();
	/** Our recent bash commands [start, end]. */
	private bash: [number, number][] = [];
	/** Changes already warned about (path → mtime). */
	private readonly warned = new Map<string, number>();

	constructor(io: PeerIo) {
		this.io = io;
	}

	noteOwnWrite(path: string, mtime: number): void {
		this.own.set(path, mtime);
	}

	noteBash(start: number, end: number): void {
		this.bash.push([start, end]);
		const horizon = end - FRESH_MS * 2;
		this.bash = this.bash.filter(([, until]) => until >= horizon);
	}

	/** A peer's fresh change to warn about, or undefined. */
	check(path: string, now = Date.now()): { ageMs: number } | undefined {
		const mtime = this.io.mtime(path);
		if (mtime === undefined) return undefined;
		const age = now - mtime;
		if (age > FRESH_MS || age < -BASH_SLACK_MS) return undefined;
		if ((this.own.get(path) ?? -Infinity) >= mtime - 1) return undefined;
		if (this.bash.some(([start, end]) => mtime >= start - BASH_SLACK_MS && mtime <= end + BASH_SLACK_MS)) return undefined;
		if (this.warned.get(path) === mtime) return undefined;
		if (!this.io.dirty(path)) return undefined;
		this.warned.set(path, mtime);
		return { ageMs: Math.max(0, age) };
	}
}
