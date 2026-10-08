// Guards of round 2: what agents may reach, how to tell an infrastructure failure from the agent's, where each harness
// keeps per-project memory, and an audit of transcripts for ways to the fix.
import { join } from "node:path";

/** Environment for the agents: git only on local repos, npm offline, gh without the user's credentials. */
export const agentEnvironment = (emptyGhConfig) => ({ GIT_ALLOW_PROTOCOL: "file", npm_config_offline: "true", GH_CONFIG_DIR: emptyGhConfig });

const LEAKS = [
	[/\bgh\s+(?:api|pr|issue|repo|search|browse)\b/, "gh"],
	[/\b(?:curl|wget)\b/, "download"],
	[/https?:\/\/(?:www\.)?(?:github\.com|raw\.githubusercontent\.com|registry\.npmjs\.org|unpkg\.com|cdn\.jsdelivr\.net)/, "url"],
	[/\bgit\s+(?:fetch|clone|pull|remote\s+add)\b/, "git rete"],
	[/\bnpm\s+(?:view|pack|info|show|i|install|add)\s+\S*@/, "npm registro"],
	[/pi-eval\/repos|work2\/mine|round2\/tasks\.json|\.cache\/pi-eval/, "fuori dalla copia"],
	[/\bWeb(?:Fetch|Search)\b|\bweb_search\b|\bfetch_content\b/, "web"],
];

/** Kinds of suspicious access found in a transcript (empty = clean). */
export function auditTranscript(text) {
	return LEAKS.filter(([pattern]) => pattern.test(text)).map(([, kind]) => kind);
}

const INFRA = /process exited|usage limit|rate.?limit|overloaded|\b5\d\d\b|authenticat|unauthori[sz]ed|credit balance|ECONNRESET|ETIMEDOUT|socket hang up/i;

/** A turn that failed for reasons outside the agent: it is retried, never recorded as the agent's FAIL. */
export function isInfraFailure(turn) {
	if (!turn.requests) return true;
	if (turn.timedOut) return false;
	return turn.errors.some((error) => INFRA.test(error));
}

/** Claude Code's project folder (auto-memory) and Pi's sessions folder for a project path. */
export function memoryStoresFor(dir, home) {
	return [join(home, ".claude/projects", dir.replace(/[^a-zA-Z0-9]/g, "-")), join(home, ".pi/agent/sessions", `--${dir.slice(1).replaceAll("/", "-")}--`)];
}
