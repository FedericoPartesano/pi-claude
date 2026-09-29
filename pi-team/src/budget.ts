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

export function decideBudget(usage: SubscriptionUsage | undefined): BudgetDecision {
	if (!usage || usage.fiveHourUtilization === undefined) return { concurrency: 2, reason: "uso abbonamento sconosciuto: parallelismo prudente 2" };
	if (usage.isUsingOverage) return { concurrency: 0, reason: "l'abbonamento sta usando extra usage: team non avviato" };
	const percent = Math.round(usage.fiveHourUtilization * 100);
	if (percent >= 90) return { concurrency: 0, reason: `finestra 5h al ${percent}%: team non avviato` };
	if (percent >= 70) return { concurrency: 1, reason: `finestra 5h al ${percent}%: un agente alla volta` };
	if (percent >= 50) return { concurrency: 2, reason: `finestra 5h al ${percent}%: parallelismo 2` };
	return { concurrency: 3, reason: `finestra 5h al ${percent}%: parallelismo 3` };
}

export function readUsage(file = USAGE_FILE): SubscriptionUsage | undefined {
	if (!existsSync(file)) return undefined;
	try {
		return JSON.parse(readFileSync(file, "utf8")) as SubscriptionUsage;
	} catch {
		return undefined;
	}
}
