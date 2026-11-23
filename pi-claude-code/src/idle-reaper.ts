/**
 * Frees the memory of idle Claude Code processes (about 250 MB each).
 * A reaped conversation is not lost: the next message restarts a process from Pi's own transcript.
 * The most recently used process is kept far longer than the others, so the conversation in
 * front of the user answers at once; the others (older models, advisors) go after a few minutes.
 */
export interface Reapable {
	lastUsed: number;
	isAlive: boolean;
	/** Streaming or waiting for a tool: never closed. */
	isBusy?: boolean;
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
		if (session.isAlive && session.isBusy) {
			session.lastUsed = now;
			return;
		}
		const limit = index === 0 ? limits.latestMs : limits.otherMs;
		if (session.isAlive && now - session.lastUsed < limit) return;
		session.dispose();
		closed.push(session);
	});
	for (const session of closed) sessions.splice(sessions.indexOf(session), 1);
	return closed;
}

export interface Evictable {
	isAlive: boolean;
	isBusy?: boolean;
	knownFingerprints: readonly string[];
	dispose(): void;
}

/** A one-shot request (one user message and its answer, or a prewarm) is never extended, so it is the cheapest loss. */
const ONE_SHOT_MESSAGES = 2;

/**
 * Trims the pool (most recently used first) to `max`. The newest session stays; a busy one (streaming or waiting
 * for a tool result) is never closed, because losing it mid-call costs the model an error and a full --resume.
 * Dead sessions go first, then one-shot ones, then the least recently used. Returns the sessions it closed.
 */
export function evictOverflow<T extends Evictable>(sessions: T[], max: number): T[] {
	const closed: T[] = [];
	const rank = (session: T): number => (!session.isAlive ? 0 : session.knownFingerprints.length <= ONE_SHOT_MESSAGES ? 1 : 2);
	while (sessions.length > max) {
		let victim = -1;
		for (let index = sessions.length - 1; index >= 1; index--) {
			const session = sessions[index];
			if (session.isAlive && session.isBusy) continue;
			if (victim === -1 || rank(session) < rank(sessions[victim])) victim = index;
		}
		if (victim === -1) break;
		const [session] = sessions.splice(victim, 1);
		session.dispose();
		closed.push(session);
	}
	return closed;
}

export interface Orphanable {
	isAlive: boolean;
	/** Requests streaming right now: such a session is never closed here. */
	activeRequests: number;
	hasPendingToolCall(id: string): boolean;
	dispose(): void;
}

/**
 * Closes the sessions (other than `chosen`) still waiting for a tool call whose result is in the request Pi just
 * sent elsewhere. Pi gave that result to another session (its history changed, e.g. after a compression), so the
 * MCP call will never be released: the session would count as busy forever and escape both reaping and eviction.
 */
export function closeOrphaned<T extends Orphanable>(sessions: T[], chosen: T, toolResultIds: readonly string[]): T[] {
	const closed = sessions.filter(
		(session) =>
			session !== chosen && session.isAlive && session.activeRequests === 0 && toolResultIds.some((id) => session.hasPendingToolCall(id)),
	);
	for (const session of closed) {
		sessions.splice(sessions.indexOf(session), 1);
		session.dispose();
	}
	return closed;
}
