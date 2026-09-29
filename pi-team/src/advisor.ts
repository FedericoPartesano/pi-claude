/**
 * Recommends Pi alone or Pi + team for a request, with the reasons. Instant local heuristic:
 * no model call, no tokens. The threshold is deliberately high: on medium jobs (eval/REPORT.md)
 * the team matched Pi alone at ~3x the cost, so it is recommended only for clearly large jobs.
 */

export interface Advice {
	recommendTeam: boolean;
	score: number;
	reasons: string[];
}

export const TEAM_THRESHOLD = 5;

const LARGE_JOB_PATTERN = /tutto il progetto|intero progetto|tutti i moduli|tutta l'app|refactoring (completo|generale|esteso)|migra(zione|re)|riscriv|end[- ]to[- ]end|da zero|ogni modulo|più moduli|intera codebase/i;
const INDEPENDENT_REVIEW_PATTERN = /revision[ea] indipendente|verifica indipendente|review (completa|approfondita)|doppio controllo/i;
const ACTION_PATTERN = /\b(correggi|aggiungi|crea|implementa|rinomina|sposta|scrivi|rimuovi|aggiorna|migra|refactor|genera|prepara|converti|sistema)\w*/i;

/** Distinct parts of a request: list items, numbered markers like (1), and "poi/inoltre" chains. */
export function countParts(text: string): number {
	const listItems = text.split("\n").filter((line) => /^\s*([-*•]|\d+[.)])\s+\S/.test(line)).length;
	// "(1) ... (2) ..." or "1. ... 2. ..." written on one line.
	const inlineNumbered = Math.max((text.match(/\(\d+\)/g) ?? []).length, (text.match(/(?:^|\s)\d+[.)]\s+\S/g) ?? []).length);
	const chained = text.split(/\b(?:e poi|poi|inoltre|infine|dopodiché)\b|;/i).filter((part) => ACTION_PATTERN.test(part)).length;
	return Math.max(listItems, inlineNumbered, chained, 1);
}

/** Distinct areas touched: top-level folders of mentioned paths plus files without a folder. */
export function countAreas(text: string): number {
	// Paths with at least one slash (also folder mentions like "test/") or bare file names.
	const paths = text.match(/[\w.-]+\/(?:[\w.-]+\/?)*|[\w-]+\.(?:ts|tsx|js|jsx|mjs|py|cs|sql|json|md|yml|yaml)\b/g) ?? [];
	const areas = new Set(paths.map((path) => {
		const segments = path.split("/");
		// apps/<app>/..., libs/<lib>/..., packages/<pkg>/... count per project; otherwise the first folder.
		return ["apps", "libs", "packages"].includes(segments[0]) && segments.length > 1 ? `${segments[0]}/${segments[1]}` : segments.length > 1 ? segments[0] : path;
	}));
	return areas.size;
}

export function adviseTeam(text: string, contextPercent?: number | null): Advice {
	const reasons: string[] = [];
	let score = 0;

	const parts = countParts(text);
	if (parts >= 8) (score += 3), reasons.push(`${parts} parti distinte`);
	else if (parts >= 5) (score += 2), reasons.push(`${parts} parti distinte`);
	else if (parts >= 3) (score += 1), reasons.push(`${parts} parti`);

	const areas = countAreas(text);
	if (areas >= 5) (score += 2), reasons.push(`${areas} aree/moduli diversi`);
	else if (areas >= 3) (score += 1), reasons.push(`${areas} aree/moduli`);

	if (LARGE_JOB_PATTERN.test(text)) (score += 2), reasons.push("lavoro dichiaratamente ampio");
	if (INDEPENDENT_REVIEW_PATTERN.test(text)) (score += 1), reasons.push("chiede una revisione indipendente");
	if (contextPercent != null && contextPercent >= 60) (score += 2), reasons.push(`contesto della sessione al ${Math.round(contextPercent)}%: il team lavora in contesti separati`);

	if (text.trim().length < 120) (score -= 2), reasons.push("richiesta breve");
	if (!ACTION_PATTERN.test(text)) (score -= 2), reasons.push("sembra una domanda, non un lavoro da fare");

	return { recommendTeam: score >= TEAM_THRESHOLD, score, reasons };
}

export function formatAdvice(advice: Advice): string {
	const verdict = advice.recommendTeam ? "Consiglio: Pi + team" : "Consiglio: Pi da solo";
	return `${verdict} (punteggio ${advice.score}, soglia ${TEAM_THRESHOLD})${advice.reasons.length ? ` — ${advice.reasons.join(", ")}` : ""}`;
}
