// Subscription guard: the Claude Code bridge writes the usage it sees; overage means extra billing, so no new job starts.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function overageActive(file = join(homedir(), ".pi/agent/claude-code-usage.json")) {
	try {
		return JSON.parse(readFileSync(file, "utf8")).isUsingOverage === true;
	} catch {
		return false;
	}
}
