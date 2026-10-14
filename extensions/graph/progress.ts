/** Text of the progress panel of /graph: phase, bar, tokens and cost, time left. Pure: the caller passes the clock. */
export interface Progress {
	title: string;
	phase: string;
	done: number;
	total: number;
	/** Tokens used by the model so far (0 for the static phases). */
	input: number;
	output: number;
	cost: number;
	startedAt: number;
	now: number;
	/** What is being processed right now. */
	current?: string;
	failed?: number;
}

export const bar = (fraction: number, width = 30) => {
	const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
	const filled = Math.round(clamped * width);
	return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
};

export const compact = (value: number) => (value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value)}`);

export function duration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

export function progressLines(progress: Progress, escToCancel = false): string[] {
	const fraction = progress.total > 0 ? progress.done / progress.total : 0;
	const elapsed = progress.now - progress.startedAt;
	const left = progress.done > 0 && progress.done < progress.total ? ` · restano ~${duration((elapsed / progress.done) * (progress.total - progress.done))}` : "";
	const tokens = progress.input || progress.output ? `${compact(progress.input)} in · ${compact(progress.output)} out · $${progress.cost.toFixed(4)}` : "nessuno in questa fase (solo codice)";
	return [
		`${progress.title} — ${progress.phase}`,
		`${bar(fraction)} ${Math.round(fraction * 100)}%  ${progress.done}/${progress.total}`,
		`Token: ${tokens}`,
		`Tempo: ${duration(elapsed)}${left}${progress.failed ? ` · ${progress.failed} non letti` : ""}`,
		...(progress.current ? [`Ora: ${progress.current}`] : []),
		...(escToCancel ? ["Esc per annullare"] : []),
	];
}
