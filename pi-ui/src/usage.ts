/** Subscription usage written by pi-claude-code after every Claude Code answer. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const USAGE_FILE = join(homedir(), ".pi/agent/claude-code-usage.json");

export interface UsageSample {
	at: number;
	u: number;
}

export interface Row {
	role: "ok" | "warn" | "err" | "dim";
	label: string;
	value: string;
}

export interface Usage {
	fiveHour?: number;
	sevenDay?: number;
	overage?: boolean;
	fiveHourResetsAt?: number;
	sevenDayResetsAt?: number;
	history?: Record<string, UsageSample[]>;
}

export function readUsage(file = USAGE_FILE): Usage | undefined {
	try {
		const usage = JSON.parse(readFileSync(file, "utf8"));
		return {
			fiveHour: usage.fiveHourUtilization,
			sevenDay: usage.sevenDayUtilization,
			overage: usage.isUsingOverage,
			fiveHourResetsAt: usage.fiveHourResetsAt,
			sevenDayResetsAt: usage.sevenDayResetsAt,
			history: usage.history,
		};
	} catch {
		return undefined;
	}
}

const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/**
 * Burn-rate estimate for the 5h window: linear regression over the last `windowMs` of samples.
 * Returns short lines for the panel (empty while there is not enough data).
 */
export function forecastLines(
	usage: Usage | undefined,
	now = Date.now(),
	windowMs = 10 * 60_000,
	minSpanMs = 3 * 60_000,
): Row[] {
	const samples = (usage?.history?.five_hour ?? []).filter((s) => now - s.at <= windowMs);
	if (usage?.fiveHour === undefined) return [];
	if (samples.length < 2 || samples[samples.length - 1].at - samples[0].at < minSpanMs) return [{ role: "dim", label: "Stima", value: "in corso…" }];
	const origin = samples[0].at;
	let sx = 0, sy = 0, sxy = 0, sxx = 0;
	for (const s of samples) {
		const x = (s.at - origin) / 60000;
		const y = s.u * 100;
		sx += x; sy += y; sxy += x * y; sxx += x * x;
	}
	const n = samples.length;
	const den = n * sxx - sx * sx;
	const rate = den === 0 ? 0 : (n * sxy - sx * sy) / den; // %/min
	if (rate <= 0.001) return [{ role: "ok", label: "Consumo", value: "fermo" }];
	const remaining = Math.max(0, 100 - usage.fiveHour * 100);
	const minToEmpty = remaining / rate;
	const empty = new Date(now + minToEmpty * 60000);
	const rateText = rate >= 0.1 ? `${rate.toFixed(1)}%/min` : `${(rate * 60).toFixed(1)}%/h`;
	const lines: Row[] = [{ role: "dim", label: "Consumo", value: rateText }];
	if (usage.fiveHourResetsAt === undefined) return [...lines, { role: "warn", label: "Esaurimento", value: clock(empty) }];
	const minToReset = (usage.fiveHourResetsAt * 1000 - now) / 60000;
	if (minToReset < 0) return lines;
	if (minToEmpty >= minToReset) {
		const left = Math.max(0, Math.round(remaining - rate * minToReset));
		return [...lines, { role: "ok", label: "Al reset restano", value: `~${left}%` }];
	}
	const gap = Math.round(minToReset - minToEmpty);
	const gapText = gap >= 60 ? `${Math.floor(gap / 60)}h${String(gap % 60).padStart(2, "0")}m` : `${gap}m`;
	return [...lines, { role: "err", label: "⚠ Esaurimento", value: clock(empty) }, { role: "err", label: "Prima del reset", value: gapText }];
}

const DAYS = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

/** "11:51" if today, "gio 14:00" otherwise; undefined when the reset time is unknown or already past. */
export function resetLabel(resetsAtSeconds: number | undefined, now = Date.now()): string | undefined {
	if (resetsAtSeconds === undefined || resetsAtSeconds * 1000 < now) return undefined;
	const d = new Date(resetsAtSeconds * 1000);
	const today = new Date(now);
	const same = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
	return same ? clock(d) : `${DAYS[d.getDay()]} ${clock(d)}`;
}
