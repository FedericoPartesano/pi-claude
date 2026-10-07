import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMentions, pick } from "../src/pick.ts";
import { listSource } from "../src/sources.ts";

const source = listSource([
	{ value: "a.ts", label: "a.ts" },
	{ value: "b.ts", label: "b.ts", description: "secondo" },
]);

function fakeContext(mode: string, hasUI: boolean, answers: { custom?: unknown; select?: string } = {}) {
	const calls: string[] = [];
	const ctx = {
		mode,
		hasUI,
		ui: {
			custom: async (_factory: unknown, options: { overlay?: boolean }) => (calls.push(`custom overlay=${options.overlay}`), answers.custom),
			select: async (title: string, options: string[]) => (calls.push(`select ${title}: ${options.join(", ")}`), answers.select),
		},
	};
	return { ctx: ctx as never, calls };
}

test("opens an overlay in the TUI", async () => {
	const { ctx, calls } = fakeContext("tui", true, { custom: ["b.ts"] });
	assert.deepEqual(await pick(ctx, { title: "File", source }), ["b.ts"]);
	assert.deepEqual(calls, ["custom overlay=true"]);
});

test("falls back to a plain select without a full TUI", async () => {
	const { ctx, calls } = fakeContext("rpc", true, { select: "b.ts — secondo" });
	assert.deepEqual(await pick(ctx, { title: "File", source }), ["b.ts"]);
	assert.deepEqual(calls, ["select File: a.ts, b.ts — secondo"]);
});

test("returns nothing without UI or when cancelled", async () => {
	assert.equal(await pick(fakeContext("print", false).ctx, { title: "File", source }), undefined);
	assert.equal(await pick(fakeContext("rpc", true).ctx, { title: "File", source }), undefined);
});

test("formats paths as @mentions, quoting the ones with spaces", () => {
	assert.equal(formatMentions(["src/a.ts", "docs/"]), "@src/a.ts @docs/ ");
	assert.equal(formatMentions(["my file.md"]), '@"my file.md" ');
	assert.equal(formatMentions([]), "");
});
