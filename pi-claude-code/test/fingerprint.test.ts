import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprintMessage } from "../src/provider.ts";

const user = (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }], timestamp: 0 });
const long = Array.from({ length: 400 }, (_, i) => `line ${i} of the skill body`).join("\n");
// What billion-context's emergency truncation sends when usage nears its limit (acp-kernel truncate-tools.ts).
// Each message also ends with billion-context's reference tag, whose size follows the truncation.
const tag = (size: string) => `\n\n<acp tokens="${size}" type="text">m00002</acp>\n`;
const truncated = `${long.slice(0, 2000)}\n\n...[truncated for context space] — original ~3311 tokens]...\n\n${long.slice(-2000)}${tag("1.0K")}`;

// Long chat K-v: the skill message flipped between full and truncated across requests, each flip a fresh
// `claude` process and a full cache write, though the model had already seen the message.
test("a message cut by context truncation keeps the fingerprint of its full text", () => {
	assert.equal(fingerprintMessage(user(truncated)), fingerprintMessage(user(long + tag("3.3K"))));
});

test("a different message still has a different fingerprint", () => {
	assert.notEqual(fingerprintMessage(user(long.replace("line 0 ", "line X "))), fingerprintMessage(user(long)));
	assert.notEqual(fingerprintMessage(user(long.replace("line 399 ", "line Y "))), fingerprintMessage(user(long)));
	assert.notEqual(fingerprintMessage(user("ok")), fingerprintMessage(user("no")));
});
