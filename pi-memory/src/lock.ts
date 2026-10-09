/**
 * One writer at a time on a memory store (two Pi sessions, /dream, /memory edits, vector filling): a lock directory
 * (mkdir is atomic). A lock older than STALE_MS belongs to a writer that died: taken over. Short sections only: read,
 * merge, write.
 */
import { mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const STALE_MS = 30_000;
const WAIT_MS = 10_000;

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function withStoreLock<T>(dir: string, section: () => T): T {
	mkdirSync(dir, { recursive: true });
	const lock = join(dir, ".lock");
	const deadline = Date.now() + WAIT_MS;
	for (;;) {
		try {
			mkdirSync(lock);
			break;
		} catch {
			let age = 0;
			try {
				age = Date.now() - statSync(lock).mtimeMs;
			} catch {
				continue; // released between the two calls
			}
			if (age > STALE_MS || Date.now() > deadline) {
				// A dead writer's lock, or waited long enough: better a late write than none.
				rmSync(lock, { recursive: true, force: true });
				continue;
			}
			sleep(25);
		}
	}
	try {
		return section();
	} finally {
		rmSync(lock, { recursive: true, force: true });
	}
}
