/** Subscription usage as reported by Claude Code's `rate_limit_event` records. */
export interface RateLimitInfo {
	status?: string;
	isUsingOverage?: boolean;
	unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }>;
}

/** "2h10m", "45m", "3g 4h": time left until a usage window resets. */
export function formatReset(resetsAtSeconds: number, nowMs: number = Date.now()): string {
	const minutes = Math.max(0, Math.round((resetsAtSeconds * 1000 - nowMs) / 60000));
	if (minutes >= 24 * 60) {
		const days = Math.floor(minutes / (24 * 60));
		const hours = Math.round((minutes % (24 * 60)) / 60);
		return hours ? `${days}g ${hours}h` : `${days}g`;
	}
	if (minutes >= 60) return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
	return `${minutes}m`;
}

export type Paint = (role: "success" | "warning" | "error" | "dim", text: string) => string;
const plain: Paint = (_role, text) => text;

const BAR_CELLS = 8;

/** "▰▰▰▱▱▱▱▱" for 0.4: filled cells round up as soon as there is any usage. */
export function usageBar(utilization: number): string {
	const clamped = Math.min(1, Math.max(0, utilization));
	const filled = clamped > 0 ? Math.max(1, Math.round(clamped * BAR_CELLS)) : 0;
	return "▰".repeat(filled) + "▱".repeat(BAR_CELLS - filled);
}

/** green below 60%, yellow below 85%, red from 85%. */
export function usageRole(utilization: number): "success" | "warning" | "error" {
	return utilization >= 0.85 ? "error" : utilization >= 0.6 ? "warning" : "success";
}

/**
 * Footer with one colored bar per usage window, e.g.
 * "5h ▰▰▰▱▱▱▱▱ 31% · reset 2h10m   7g ▰▱▱▱▱▱▱▱ 11%".
 * `paint` applies the terminal theme colors; without it the text is plain.
 */
export function renderSubscriptionStatus(info: RateLimitInfo, nowMs: number = Date.now(), paint: Paint = plain): string {
	const windows = info.unifiedWindows ?? {};
	const cell = (name: string, label: string, withReset: boolean) => {
		const window = windows[name];
		if (!window) return undefined;
		const used = window.utilization ?? 0;
		const role = usageRole(used);
		const reset = withReset && window.resetsAt ? paint("dim", ` · reset ${formatReset(window.resetsAt, nowMs)}`) : "";
		return `${paint("dim", label)} ${paint(role, usageBar(used))} ${paint(role, `${Math.round(used * 100)}%`)}${reset}`;
	};
	const warnings = [
		info.isUsingOverage ? paint("error", "crediti extra in uso") : undefined,
		info.status && info.status !== "allowed" ? paint("error", `limite: ${info.status}`) : undefined,
	];
	return [cell("five_hour", "5h", true), cell("seven_day", "7g", false), ...warnings].filter(Boolean).join("   ");
}
