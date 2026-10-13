/**
 * Hides what looks like a secret in text that leaves the machine (the copy sent by /bug; the copy kept on disk is whole).
 * It knows common shapes only: it cannot catch a secret that looks like any other word, so the form says so.
 */
const MASK = "[oscurato]";

const PATTERNS: [RegExp, string | ((...match: string[]) => string)][] = [
	[/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, MASK],
	// scheme://user:password@host → keeps the user and the host
	[/\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/"']+):([^\s@/"']+)@/gi, (_all, head) => `${head}:${MASK}@`],
	[/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, MASK],
	[/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, MASK],
	[/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g, MASK],
	[/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, MASK],
	[/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, MASK],
	[/\bAIza[A-Za-z0-9_-]{30,}\b/g, MASK],
	[/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, `Bearer ${MASK}`],
	// "password: x", "password è x", "token=x", "api_key": "x"
	[/\b((?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|apikey|access[_-]?key|chiave|credenziali)\b["']?\s*(?:[:=]|è|e'|is|=>)\s*["']?)([^\s"',;]{3,})/gi, (_all, head) => `${head}${MASK}`],
];

export function redact(text: string): string {
	let out = text;
	for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement as never);
	return out;
}

/** An environment variable whose value must not be written down. */
export const SECRET_NAME = /KEY|TOKEN|SECRET|PASS|PWD|CREDENTIAL|AUTH|COOKIE|URI|URL_WITH/i;
