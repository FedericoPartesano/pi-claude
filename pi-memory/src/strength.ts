import type { MemoryRecord } from "./store.ts";

/** Memory strength in (0, 1]: confirmations raise it, time since the last confirmation fades it (never to zero). */
export function strength(record: Pick<MemoryRecord, "confirmations" | "last">, today: string): number {
	const base = 1 - 1 / (1 + Math.max(1, record.confirmations));
	const last = Date.parse(record.last);
	const days = Number.isFinite(last) ? Math.max(0, (Date.parse(today) - last) / 86_400_000) : 365;
	return base * (0.5 + 0.5 * Math.exp(-days / 180));
}
