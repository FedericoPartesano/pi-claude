import assert from "node:assert/strict";
import { test } from "node:test";
import { renderFooter } from "../src/footer.ts";

test("renderFooter: modalità senza permessi sempre visibile", () => {
	const base = { statuses: new Map<string, string>(), project: "p", changes: 0, model: "m", thinking: "t" };
	assert.match(renderFooter({ ...base, yolo: true }, 120), /SENZA PERMESSI/);
	assert.doesNotMatch(renderFooter(base, 120), /SENZA PERMESSI/);
});
