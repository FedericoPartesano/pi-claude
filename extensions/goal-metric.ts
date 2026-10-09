/**
 * /goal --metric: the goal as a series of experiments judged by a number (from claude-mods' iterate, after Karpathy's
 * autoresearch). Each model round is one attempt; when it settles the metric command runs: better than the best so far,
 * the round is committed on the goal's own branch; not better (or the metric breaks), it is put aside with git stash —
 * recoverable, never reset. The model sees the history in its reminder, so it knows what worked.
 */
import { spawn } from "node:child_process";
import { slugify } from "./intent.ts";

export interface MetricSpec {
	command: string;
	/** "lower" (default: time, size, errors) or "higher" (throughput, score). */
	direction: "lower" | "higher";
	/** Stop when the metric gets here. */
	target?: number;
}

export interface MetricRound {
	round: number;
	value?: number;
	kept: boolean;
	note?: string;
}

export interface MetricState extends MetricSpec {
	branch: string;
	baseline?: number;
	best?: number;
	history: MetricRound[];
}

const TIMEOUT_MS = 10 * 60 * 1000;
const HISTORY_SHOWN = 8;

function sh(command: string, cwd: string): Promise<{ ok: boolean; output: string }> {
	return new Promise((resolve) => {
		const child = spawn("bash", ["-c", command], { cwd, timeout: TIMEOUT_MS });
		let output = "";
		const collect = (chunk: Buffer) => {
			output = (output + chunk.toString()).slice(-4000);
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
		child.on("error", (error) => resolve({ ok: false, output: `${output}\n${error.message}` }));
		child.on("close", (code) => resolve({ ok: code === 0, output }));
	});
}

const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;

/** The last number the command prints (a decimal comma is read as a point). */
export function parseMetricValue(output: string): number | undefined {
	const numbers = output.match(/-?\d+(?:[.,]\d+)?(?:e[-+]?\d+)?/gi);
	if (!numbers) return undefined;
	const value = Number(numbers[numbers.length - 1].replace(",", "."));
	return Number.isFinite(value) ? value : undefined;
}

export function improves(value: number, best: number | undefined, direction: MetricSpec["direction"]): boolean {
	if (best === undefined) return true;
	return direction === "lower" ? value < best : value > best;
}

const reached = (value: number, spec: MetricSpec) => spec.target !== undefined && (spec.direction === "lower" ? value <= spec.target : value >= spec.target);

async function measure(cwd: string, command: string): Promise<{ value?: number; problem?: string }> {
	const result = await sh(command, cwd);
	if (!result.ok) return { problem: `la metrica fallisce: ${result.output.trim().split("\n").pop()?.slice(0, 160) ?? ""}` };
	const value = parseMetricValue(result.output);
	return value === undefined ? { problem: "la metrica non stampa un numero (senza numero)" } : { value };
}

/** Clean tree required (a discarded round must only put aside the model's own changes); then a branch and a baseline. */
export async function beginMetric(cwd: string, spec: MetricSpec, text: string): Promise<{ ok: true; state: MetricState } | { ok: false; reason: string }> {
	const status = await sh("git status --porcelain", cwd);
	if (!status.ok) return { ok: false, reason: "--metric vuole un repository git (ogni giro migliore diventa un commit)." };
	if (status.output.trim()) return { ok: false, reason: "--metric vuole il working tree pulito: committa o metti da parte le modifiche, così un giro scartato toglie solo le modifiche del modello." };
	const baseline = await measure(cwd, spec.command);
	if (baseline.value === undefined) return { ok: false, reason: `Misura iniziale non riuscita: ${baseline.problem}. Controlla il comando: \`${spec.command}\`.` };
	const base = `goal/metric-${slugify(text.split(/\s+/).slice(0, 5).join(" ")) || "run"}`;
	let branch = base;
	for (let n = 2; (await sh(`git rev-parse --verify --quiet ${quote(`refs/heads/${branch}`)}`, cwd)).ok; n++) branch = `${base}-${n}`;
	const switched = await sh(`git switch -q -c ${quote(branch)}`, cwd);
	if (!switched.ok) return { ok: false, reason: `Non riesco a creare il branch ${branch}: ${switched.output.trim()}` };
	return { ok: true, state: { ...spec, branch, baseline: baseline.value, best: baseline.value, history: [] } };
}

/** Measure the round just ended: commit it if better, stash it otherwise. One chat line says which. */
export async function settleRound(cwd: string, state: MetricState, round: number): Promise<{ kept: boolean; line: string; targetReached?: boolean }> {
	const record = (entry: MetricRound, line: string, targetReached?: boolean) => {
		state.history.push(entry);
		return { kept: entry.kept, line, targetReached };
	};
	const status = await sh("git status --porcelain", cwd);
	if (!status.output.trim()) return record({ round, kept: false, note: "nessuna modifica" }, `◦ giro ${round}: nessuna modifica da misurare`);
	const { value, problem } = await measure(cwd, state.command);
	if (value !== undefined && improves(value, state.best, state.direction)) {
		const previous = state.best;
		await sh(`git add -A && git commit -q -m ${quote(`goal metric: ${previous} → ${value} (giro ${round})`)}`, cwd);
		state.best = value;
		const target = reached(value, state);
		return record({ round, value, kept: true }, `▲ giro ${round}: ${previous} → ${value} · tenuto (commit)${target ? " · obiettivo raggiunto" : ""}`, target);
	}
	await sh(`git stash push -q -u -m ${quote(`goal-metric giro ${round}: ${value ?? problem}`)}`, cwd);
	const why = value === undefined ? problem! : `${value} non migliora ${state.best}`;
	return record({ round, value, kept: false, note: value === undefined ? problem : undefined }, `▽ giro ${round}: ${why} · scartato (git stash)`);
}

/** For the model's reminder: what is measured, where it stands, what each round did. */
export function metricLines(state: MetricState): string {
	const recent = state.history.slice(-HISTORY_SHOWN).map((entry) => `- giro ${entry.round}: ${entry.value ?? entry.note ?? "?"} · ${entry.kept ? "tenuto" : "scartato"}`);
	return [
		`Metrica (\`${state.command}\`, meglio ${state.direction === "lower" ? "più basso" : "più alto"}${state.target !== undefined ? `, obiettivo ${state.target}` : ""}): ${state.baseline} → migliore ${state.best}. Branch ${state.branch}.`,
		...(recent.length ? ["Giri:", ...recent] : []),
		"Ogni giro è un esperimento: fai una modifica mirata e fermati; a fine giro misuro, tengo il commit se migliora, altrimenti lo metto da parte (git stash). Non committare tu e non toccare il comando della metrica.",
	].join("\n");
}
