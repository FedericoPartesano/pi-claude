/**
 * Adaptive parallelism from the Claude subscription usage that pi-claude-code records in
 * ~/.pi/agent/claude-code-usage.json after every Claude Code answer.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const USAGE_FILE = join(homedir(), ".pi/agent/claude-code-usage.json");

export interface SubscriptionUsage {
	fiveHourUtilization?: number;
	sevenDayUtilization?: number;
	isUsingOverage?: boolean;
	updatedAt?: string;
}

export interface BudgetDecision {
	/** Maximum agents running at the same time; 0 means do not start. */
	concurrency: number;
	reason: string;
}

/** Most agents at the same time; PI_PARALLEL_MAX lowers (or raises) it, e.g. on a machine with little memory. */
export const MAX_PARALLEL = 8;

export function maxParallel(env: NodeJS.ProcessEnv = process.env): number {
	const value = Number.parseInt(env.PI_PARALLEL_MAX ?? "", 10);
	return Number.isFinite(value) && value >= 1 ? value : MAX_PARALLEL;
}

/**
 * Aggressive by choice (speed first): full parallelism until 80% of the 5-hour window, then it slows down
 * and stops at 95% or when extra usage kicks in.
 */
export function decideBudget(usage: SubscriptionUsage | undefined, cap = maxParallel()): BudgetDecision {
	const at = (concurrency: number, reason: string): BudgetDecision => {
		const bounded = Math.min(concurrency, cap);
		return { concurrency: bounded, reason: bounded > 0 ? `${reason}: fino a ${bounded} agenti insieme` : reason };
	};
	if (usage?.isUsingOverage) return at(0, "l'abbonamento sta usando extra usage: niente agenti in più");
	if (!usage || usage.fiveHourUtilization === undefined) return at(4, "uso abbonamento sconosciuto");
	const percent = Math.round(usage.fiveHourUtilization * 100);
	if (percent >= 95) return at(0, `finestra 5h al ${percent}%: niente agenti in più`);
	if (percent >= 90) return at(1, `finestra 5h al ${percent}%`);
	if (percent >= 80) return at(3, `finestra 5h al ${percent}%`);
	return at(cap, `finestra 5h al ${percent}%`);
}

/** The live limit: re-reads the usage file at every call, so a long run slows down as the window fills. */
export function liveConcurrency(file = USAGE_FILE): () => number {
	return () => Math.max(1, decideBudget(readUsage(file)).concurrency);
}

export function readUsage(file = USAGE_FILE): SubscriptionUsage | undefined {
	if (!existsSync(file)) return undefined;
	try {
		return JSON.parse(readFileSync(file, "utf8")) as SubscriptionUsage;
	} catch {
		return undefined;
	}
}
