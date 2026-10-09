// What the chat derives from turns, as plain functions: exchanges (a user message and what followed; the previous ones
// fold to one line), the files a turn changed, the result shown at the end of each step row.
import type { Part, Step, Turn } from "./state";

type UserTurn = Extract<Turn, { role: "user" }>;
type PiTurn = Extract<Turn, { role: "pi" }>;
export type Exchange = { id: number; user?: UserTurn; items: Turn[] };

export function exchanges(turns: Turn[]): Exchange[] {
	const out: Exchange[] = [];
	for (const turn of turns) {
		if (turn.role === "user") out.push({ id: turn.id, user: turn, items: [] });
		else if (out.length && out[out.length - 1].user) out[out.length - 1].items.push(turn);
		else out.push({ id: turn.id, items: [turn] });
	}
	return out;
}

export type Edit = { oldText: string; newText: string };
export function editsOf(args: Record<string, unknown> = {}): Edit[] {
	if (Array.isArray(args.edits)) return (args.edits as Edit[]).filter((edit) => edit && typeof edit.newText === "string").map(({ oldText, newText }) => ({ oldText: oldText ?? "", newText }));
	if (typeof args.newText === "string") return [{ oldText: String(args.oldText ?? ""), newText: args.newText }];
	return [];
}

const lines = (text: string) => (text ? text.split("\n").length : 0);
const pathOf = (step: Step) => String(step.args?.path ?? step.args?.file_path ?? "");

export type Change = { path: string; status: "M" | "A"; add: number; del: number; edits: Edit[] };
/** Files written or edited by the steps that succeeded, in order of first change. Written without being read: added. */
export function changes(steps: Step[]): Change[] {
	const out = new Map<string, Change>();
	const read = new Set<string>();
	for (const step of steps) {
		const path = pathOf(step);
		if (!path || step.state !== "ok") continue;
		if (step.name === "read") read.add(path);
		if (step.name !== "edit" && step.name !== "write") continue;
		const change = out.get(path) ?? { path, status: step.name === "write" && !read.has(path) ? "A" : "M", add: 0, del: 0, edits: [] };
		if (step.name === "edit") {
			for (const edit of editsOf(step.args)) {
				change.add += lines(edit.newText);
				change.del += lines(edit.oldText);
				change.edits.push(edit);
			}
		} else change.add += lines(String(step.args?.content ?? ""));
		out.set(path, change);
	}
	return [...out.values()];
}

/** Passed and failed tests in a test runner's output (mocha/jest "13 passing", vitest "12 passed", node:test "ℹ pass 28"). */
export function testCounts(output = ""): { pass: number; fail: number } | undefined {
	const number = (pattern: RegExp) => {
		const match = pattern.exec(output);
		return match ? Number(match[1]) : undefined;
	};
	const pass = number(/ℹ pass (\d+)/) ?? number(/(\d+) (?:passing|passed)\b/);
	const fail = number(/ℹ fail (\d+)/) ?? number(/(\d+) (?:failing|failed)\b/) ?? 0;
	return pass === undefined && !fail ? undefined : { pass: pass ?? 0, fail };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")}s`;
export type Result = { t: string; c: "add" | "del" | "ok" | "err" | "dim" | "run" };
export function stepResult(step: Step): Result[] {
	if (step.state === "run") return [];
	if (step.state === "err") return [{ t: "errore", c: "err" }];
	if (step.name === "edit") {
		const edits = editsOf(step.args);
		if (edits.length) return [{ t: `+${edits.reduce((n, e) => n + lines(e.newText), 0)}`, c: "add" }, { t: `−${edits.reduce((n, e) => n + lines(e.oldText), 0)}`, c: "del" }];
	}
	if (step.name === "write" && typeof step.args?.content === "string") return [{ t: `+${lines(step.args.content as string)}`, c: "add" }];
	const tests = step.name === "bash" ? testCounts(step.output) : undefined;
	if (tests?.fail) return [{ t: `${tests.fail} falliti su ${tests.pass + tests.fail}`, c: "err" }];
	const time: Result[] = step.ms === undefined ? [] : [{ t: step.ms < 1000 ? `${step.ms} ms` : seconds(step.ms), c: "dim" }];
	if (tests) return [{ t: `${tests.pass} pass`, c: "ok" }, ...time];
	return step.ms === undefined ? [] : [{ t: step.ms < 1000 ? `${step.ms} ms` : seconds(step.ms), c: "dim" }];
}

export function stepsOf(turn: PiTurn): Step[] {
	return turn.parts.flatMap((part) => (part.kind === "steps" ? part.steps : []));
}

/** "2 file · 1 errore": what a block of steps did, besides its count. */
export function stepsSummary(steps: Step[]): string {
	const files = changes(steps).length;
	const errors = steps.filter((step) => step.state === "err").length;
	// The last test run tells how the tests stand.
	const run = [...steps].reverse().find((step) => step.name === "bash" && step.state === "ok" && testCounts(step.output));
	const tests = run && testCounts(run.output)!;
	const testText = tests ? (tests.fail ? `${tests.fail} test falliti` : `${tests.pass} test ok`) : "";
	return [files ? `${files} file` : "", testText, errors ? `${errors} ${errors === 1 ? "errore" : "errori"}` : ""].filter(Boolean).join(" · ");
}

export const duration = (total: number) => (total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`);
export const tokens = (count = 0) => (count < 1000 ? String(count) : count < 1_000_000 ? `${(count / 1000).toFixed(1).replace(".", ",")}k` : `${(count / 1_000_000).toFixed(1).replace(".", ",")}M`);

/** A previous exchange on one line: ✓ or ✗, the prompt, files and time. */
export function folded(exchange: Exchange): { ok: boolean; text: string; meta: string } {
	const pis = exchange.items.filter((turn): turn is PiTurn => turn.role === "pi");
	const steps = pis.flatMap(stepsOf);
	const failed = pis.some((turn) => turn.parts.some((part: Part) => part.kind === "error"));
	const files = changes(steps).length;
	const time = pis.reduce((n, turn) => n + (turn.seconds ?? 0), 0);
	const meta = [files ? `${files} file` : steps.length ? `${steps.length} passi` : "", time ? duration(time) : ""].filter(Boolean).join(" · ");
	return { ok: !failed, text: (exchange.user?.text ?? "").replace(/\s+/g, " ").trim(), meta };
}
