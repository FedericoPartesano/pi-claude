/**
 * "Don't recall for requests like this": when a memory fired by mistake, the request that fired it is kept on the memory
 * (`avoid`). A later request that says nearly the same thing no longer brings the memory in; everything else does.
 * Local and free: words in common, no model.
 */
import type { MemoryRecord } from "./store.ts";

const words = (text: string) =>
	new Set(text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((word) => word.length > 2));

/** Dice similarity of the words of two texts, 0..1. */
export function similarity(a: string, b: string): number {
	const [x, y] = [words(a), words(b)];
	if (x.size === 0 || y.size === 0) return 0;
	let common = 0;
	for (const word of x) if (y.has(word)) common++;
	return (2 * common) / (x.size + y.size);
}

/** Requests closer than this to a kept one count as "the same kind of request". */
export const AVOID_SIMILARITY = 0.6;
/** How many requests are kept per memory (the oldest go first). */
export const AVOID_MAX = 8;

export function isAvoided(record: Pick<MemoryRecord, "avoid">, query: string): boolean {
	return (record.avoid ?? []).some((past) => similarity(past, query) >= AVOID_SIMILARITY);
}

/** The list with the request added (no duplicates, capped); requests are clipped to keep the store small. */
export function addAvoid(avoid: string[] | undefined, query: string): string[] {
	const text = query.replace(/\s+/g, " ").trim().slice(0, 300);
	if (!text) return avoid ?? [];
	return [...(avoid ?? []).filter((past) => past !== text), text].slice(-AVOID_MAX);
}
