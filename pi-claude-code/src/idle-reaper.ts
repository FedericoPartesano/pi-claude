/**
 * Frees the memory of idle Claude Code processes (about 250 MB each).
 * A reaped conversation is not lost: the next message restarts a process from Pi's own transcript.
 * The most recently used process is kept far longer than the others, so the conversation in
 * front of the user answers at once; the others (older models, advisors) go after a few minutes.
 */
export interface Reapable {
	lastUsed: number;
	isAlive: boolean;
	dispose(): void;
}

const MINUTE = 60_000;

export interface ReapLimits {
	/** Idle time after which a process that is not the most recent is closed. */
	otherMs: number;
	/** Idle time after which even the most recent process is closed. */
	latestMs: number;
}

export function reapLimits(env: NodeJS.ProcessEnv = process.env): ReapLimits {
	const minutes = (name: string, fallback: number): number => {
		const value = Number(env[name]);
		return Number.isFinite(value) && value >= 0 ? value * MINUTE : fallback * MINUTE;
	};
	return { otherMs: minutes("PI_CLAUDE_IDLE_OTHER_MIN", 5), latestMs: minutes("PI_CLAUDE_IDLE_LATEST_MIN", 60) };
}

/** `sessions` is ordered most recently used first. Returns the sessions it closed. */
export function reapIdle<T extends Reapable>(sessions: T[], now: number, limits: ReapLimits): T[] {
	const closed: T[] = [];
	sessions.forEach((session, index) => {
		const limit = index === 0 ? limits.latestMs : limits.otherMs;
		if (session.isAlive && now - session.lastUsed < limit) return;
		session.dispose();
		closed.push(session);
	});
	for (const session of closed) sessions.splice(sessions.indexOf(session), 1);
	return closed;
}
