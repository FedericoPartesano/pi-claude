/** Crashes Pi wrote to ~/.pi/agent/crashes.json that were never offered for a report: which are new, and how to turn one into a bug form. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BugForm } from "./bundle.ts";

export interface CrashEntry {
	timestamp: string;
	version?: string;
	message: string;
	stack?: string;
	cwd?: string;
	sessionFile?: string;
}

/** Only crashes this recent are offered; older ones are marked as seen without asking. */
export const CRASH_DAYS = 7;

export const crashId = (entry: CrashEntry) => createHash("sha1").update(`${entry.timestamp}\n${entry.message}`).digest("hex").slice(0, 16);

const readJson = (file: string): unknown => {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
};

export const crashesFile = (home: string) => join(home, ".pi", "agent", "crashes.json");
export const seenFile = (home: string) => join(home, ".pi", "agent", "bug-seen-crashes.json");

export function readCrashes(home: string): CrashEntry[] {
	const data = readJson(crashesFile(home));
	return Array.isArray(data) ? data.filter((entry): entry is CrashEntry => typeof entry?.timestamp === "string" && typeof entry?.message === "string") : [];
}

export function readSeen(home: string): Set<string> {
	const data = readJson(seenFile(home));
	return new Set(Array.isArray(data) ? data.filter((id): id is string => typeof id === "string") : []);
}

export function markSeen(home: string, ids: string[]): void {
	const file = seenFile(home);
	mkdirSync(dirname(file), { recursive: true });
	// Keep the list short: ids of crashes no longer in crashes.json are useless.
	const alive = new Set(readCrashes(home).map(crashId));
	writeFileSync(file, JSON.stringify([...new Set([...readSeen(home), ...ids])].filter((id) => alive.has(id))));
}

/** `fresh`: to offer; `stale`: too old or already offered, to mark as seen without asking. */
export function splitCrashes(entries: CrashEntry[], seen: ReadonlySet<string>, now: Date, days = CRASH_DAYS): { fresh: CrashEntry[]; skip: CrashEntry[] } {
	const limit = now.getTime() - days * 86_400_000;
	const fresh: CrashEntry[] = [];
	const skip: CrashEntry[] = [];
	for (const entry of entries) {
		if (seen.has(crashId(entry))) continue;
		(Date.parse(entry.timestamp) >= limit ? fresh : skip).push(entry);
	}
	return { fresh, skip };
}

export function crashForm(entry: CrashEntry, send: boolean, redact = true): BugForm {
	const firstLine = entry.message.split("\n")[0].slice(0, 100);
	const at = entry.stack?.split("\n").find((line) => /^\s+at /.test(line))?.trim();
	return {
		kind: "crash",
		title: `Crash: ${firstLine}`,
		happened: `Pi ${entry.version ?? "?"} si è chiuso il ${entry.timestamp}.\n${entry.message}${at ? `\n${at}` : ""}`,
		expected: "Che Pi non si chiudesse.",
		severity: "blocca",
		redact,
		send,
	};
}

export const crashExists = (entry: CrashEntry) => Boolean(entry.sessionFile && existsSync(entry.sessionFile));
