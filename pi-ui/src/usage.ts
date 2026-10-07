/** Subscription usage written by pi-claude-code after every Claude Code answer. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const USAGE_FILE = join(homedir(), ".pi/agent/claude-code-usage.json");

export function readUsage(file = USAGE_FILE): { fiveHour?: number; sevenDay?: number; overage?: boolean } | undefined {
	try {
		const usage = JSON.parse(readFileSync(file, "utf8"));
		return { fiveHour: usage.fiveHourUtilization, sevenDay: usage.sevenDayUtilization, overage: usage.isUsingOverage };
	} catch {
		return undefined;
	}
}
