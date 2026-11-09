import assert from "node:assert/strict";
import test from "node:test";
import { isClassic } from "./pi.mjs";

test("the new frontend is the default on a TTY", () => {
	assert.equal(isClassic([], {}, true), false);
	assert.equal(isClassic(["--model", "haiku", "-r"], {}, true), false);
	assert.equal(isClassic(["@intents/x.md"], {}, true), false);
});
test("classic by option or environment", () => {
	assert.equal(isClassic(["--classic"], {}, true), true);
	assert.equal(isClassic([], { PI_UI_CLASSIC: "1" }, true), true);
	assert.equal(isClassic([], { PI_UI: "off" }, true), true);
});
test("non-interactive uses and pipes stay classic", () => {
	assert.equal(isClassic(["-p", "ciao"], {}, true), true);
	assert.equal(isClassic(["--mode", "rpc"], {}, true), true);
	assert.equal(isClassic(["--version"], {}, true), true);
	assert.equal(isClassic(["install", "npm:x"], {}, true), true);
	assert.equal(isClassic([], {}, false), true);
});
