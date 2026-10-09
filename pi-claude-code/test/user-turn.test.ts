import { test } from "node:test";
import assert from "node:assert/strict";
import { oneUserTurn } from "../src/user-turn.ts";

test("several user messages of one Pi turn go to Claude Code as ONE message (two were answered as two turns)", () => {
	const toBlocks = (content: string | { type: string; text: string }[]) => (typeof content === "string" ? [{ type: "text", text: content }] : content);
	const content = oneUserTurn([{ content: "cerca" }, { content: [{ type: "text", text: "Ricordi pertinenti: …" }] }], toBlocks);
	assert.deepEqual(content, [
		{ type: "text", text: "cerca" },
		{ type: "text", text: "Ricordi pertinenti: …" },
	]);
	assert.equal(oneUserTurn([], toBlocks), undefined);
});
