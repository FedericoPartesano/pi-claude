import test from "node:test";
import assert from "node:assert/strict";
import { codeBlocks, osc52, clipCommands } from "../prototype/rpc-chat/copy.mjs";

test("codeBlocks: ordered contents, charts skipped, open block still copyable", () => {
	const t = "intro\n```ts\nconst a = 1;\n\nconst b = 2;\n```\ntesto\n```grafico\n{\"tipo\":\"barre\"}\n```\n```\nls -la\n```\n```py\nprint(1)";
	assert.deepEqual(codeBlocks(t), ["const a = 1;\n\nconst b = 2;", "ls -la", "print(1)"]);
	assert.deepEqual(codeBlocks("niente codice"), []);
	assert.deepEqual(codeBlocks("```grafico\nnon json\n```"), ["non json"], "broken chart falls back to code");
});

test("osc52 encodes utf8 as base64; clip commands per platform", () => {
	assert.equal(osc52("àb"), `\x1b]52;c;${Buffer.from("àb").toString("base64")}\x07`);
	assert.equal(clipCommands("win32")[0][0], "clip");
	assert.deepEqual(clipCommands("linux").map((c) => c[0]), ["clip.exe", "wl-copy", "xclip"]);
});

test("rowsText: strips colors and gutters, drops code borders", async () => {
	const { rowText, rowsText } = await import("../prototype/rpc-chat/copy.mjs");
	const body = ["\x1b[2m▍\x1b[0m Ecco:   ", "▍ ╭───── bash [1] ", "▍ │ ls -la   ", "▍ ╰────", "\x1b[2m▍\x1b[0m fine"];
	assert.equal(rowText(body[1]), undefined);
	assert.equal(rowsText(body, 0, 4), "Ecco:\nls -la\nfine");
	assert.equal(rowsText(body, 2, 2), "ls -la");
});
