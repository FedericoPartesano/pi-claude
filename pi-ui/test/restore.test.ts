import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreSession } from "../src/restore.ts";

const image = (ref: string) => ({ type: "custom", customType: "pi-ui-image", data: { ref } });
const tips = (...items: string[]) => ({ type: "custom", customType: "pi-ui-suggestions", data: { items } });
const user = { type: "message", message: { role: "user" } };

test("a resumed session gets back its images and the suggestions of its last turn", () => {
	const restored = restoreSession([user, image("a.png"), tips("uno", "due"), user, image("b.png"), image("a.png"), tips("tre")]);
	assert.deepEqual(restored, { images: ["a.png", "b.png"], suggestions: ["tre"] });
});

test("suggestions already answered by a later user message are not offered again", () => {
	assert.deepEqual(restoreSession([user, tips("uno"), user]).suggestions, []);
	assert.deepEqual(restoreSession([]), { images: [], suggestions: [] });
	assert.deepEqual(restoreSession([{ type: "custom", customType: "pi-ui-image" }]).images, []);
});
