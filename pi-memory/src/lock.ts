/**
 * One writer at a time on a memory store (two Pi sessions, /dream, /memory edits, vector filling): a lock directory
 * (mkdir is atomic) holding the holder's token. A lock older than STALE_MS belongs to a writer that died: taken over;
 * a holder releases only its own lock. Short sections only: read, merge, write. The UI thread waits with
 * withStoreLockAsync (event loop free); the worker may wait synchronously.
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const STALE_MS = 30_000;
const WAIT_MS = 10_000;

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** One attempt: the token when taken, undefined when busy (a stale or overdue lock is cleared for the next attempt). */
function attempt(lock: string, deadline: number): string | undefined {
	try {
		mkdirSync(lock);
		const token = randomUUID();
		writeFileSync(join(lock, "token"), token);
		return token;
	} catch {
		let age = 0;
		try {
			age = Date.now() - statSync(lock).mtimeMs;
		} catch {
			return undefined; // released between the two calls: try again at once
		}
		// A dead writer's lock, or waited long enough: better a late write than none.
		if (age > STALE_MS || Date.now() > deadline) rmSync(lock, { recursive: true, force: true });
		return undefined;
	}
}

function release(lock: string, token: string) {
	try {
		if (readFileSync(join(lock, "token"), "utf8") !== token) return; // taken over meanwhile: not ours anymore
	} catch {
		return;
	}
	rmSync(lock, { recursive: true, force: true });
}

export function withStoreLock<T>(dir: string, section: () => T): T {
	mkdirSync(dir, { recursive: true });
	const lock = join(dir, ".lock");
	const deadline = Date.now() + WAIT_MS;
	let token: string | undefined;
	while (!(token = attempt(lock, deadline))) sleepSync(25);
	try {
		return section();
	} finally {
		release(lock, token);
	}
}

/** The same lock, waited for without blocking the event loop (Pi's UI thread). */
export async function withStoreLockAsync<T>(dir: string, section: () => T): Promise<T> {
	mkdirSync(dir, { recursive: true });
	const lock = join(dir, ".lock");
	const deadline = Date.now() + WAIT_MS;
	let token: string | undefined;
	while (!(token = attempt(lock, deadline))) await new Promise((resolve) => setTimeout(resolve, 25));
	try {
		return section();
	} finally {
		release(lock, token);
	}
}
