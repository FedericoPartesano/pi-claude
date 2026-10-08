/**
 * Re-reads of unchanged files: when the model reads the same range of a file whose content has not changed since an
 * earlier read in this session (and no compaction happened since), the content is already in its context, so a short
 * note replaces it. reset() after a compaction.
 */
import { createHash } from "node:crypto";

export interface ReadCall {
	path: string;
	offset?: number;
	limit?: number;
	content: string;
	/** Reads shorter than this always pass (the note would not save anything). */
	minChars?: number;
}

export class ReadTracker {
	private readonly seen = new Map<string, { hash: string; read: number }>();
	private reads = 0;

	check({ path, offset, limit, content, minChars = 0 }: ReadCall): string | undefined {
		this.reads++;
		const key = `${path}|${offset ?? ""}|${limit ?? ""}`;
		const hash = createHash("sha1").update(content).digest("hex");
		const before = this.seen.get(key);
		if (before && before.hash === hash && content.length >= minChars) {
			return `[invariato dalla lettura ${before.read} di questa sessione: stesso contenuto, è già nel contesto. Se ti serve di nuovo, rileggi un intervallo con offset/limit.]`;
		}
		this.seen.set(key, { hash, read: this.reads });
		return undefined;
	}

	reset(): void {
		this.seen.clear();
	}
}
