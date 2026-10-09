// What the chat derives from a turn: exchanges (previous ones fold to one line), file changes, step results.
import { test } from "node:test";
import assert from "node:assert/strict";
import { exchanges, changes, stepResult, stepsSummary, duration, tokens, folded, editsOf } from "../renderer/src/turns.ts";

const user = (id, text) => ({ id, role: "user", text });
const pi = (id, parts, extra = {}) => ({ id, role: "pi", parts, suggestions: [], done: true, ...extra });
const step = (name, args, state = "ok", extra = {}) => ({ id: `${name}${Math.random()}`, name, args, state, ...extra });

test("exchanges: each user message with what follows; notes before the first stay on their own", () => {
	const turns = [{ id: 1, role: "note", text: "ripresa" }, user(2, "a"), pi(3, []), { id: 4, role: "note", text: "n" }, user(5, "b"), pi(6, [])];
	assert.deepEqual(exchanges(turns).map((e) => [e.id, e.user?.text, e.items.map((t) => t.id)]), [[1, undefined, [1]], [2, "a", [3, 4]], [5, "b", [6]]]);
});

test("edits: Pi's edit arguments in both shapes", () => {
	assert.deepEqual(editsOf({ edits: [{ oldText: "a", newText: "b" }] }), [{ oldText: "a", newText: "b" }]);
	assert.deepEqual(editsOf({ oldText: "x", newText: "y\nz" }), [{ oldText: "x", newText: "y\nz" }]);
	assert.deepEqual(editsOf({}), []);
});

test("changes: modified and added files with line counts; failed steps do not count", () => {
	const steps = [
		step("read", { path: "src/cart.js" }),
		step("edit", { path: "src/cart.js", edits: [{ oldText: "  return a;", newText: "  return a * q;" }] }),
		step("write", { path: "test/cart.test.js", content: "a\nb\nc" }),
		step("edit", { path: "x.js", oldText: "a", newText: "b" }, "err"),
	];
	assert.deepEqual(changes(steps).map(({ path, status, add, del }) => [path, status, add, del]), [["src/cart.js", "M", 1, 1], ["test/cart.test.js", "A", 3, 0]]);
});

test("step results: diff counts, durations, running and failed", () => {
	assert.deepEqual(stepResult(step("edit", { path: "a", oldText: "a", newText: "b\nc" })), [{ t: "+2", c: "add" }, { t: "−1", c: "del" }]);
	assert.deepEqual(stepResult(step("bash", { command: "npm test" }, "ok", { ms: 2100 })), [{ t: "2,1s", c: "dim" }]);
	assert.deepEqual(stepResult(step("bash", {}, "err")), [{ t: "errore", c: "err" }]);
	assert.deepEqual(stepResult(step("read", {}, "run")), []);
});

test("summary, duration and tokens in the words of the mockup", () => {
	const steps = [step("edit", { path: "a", oldText: "a", newText: "b" }), step("write", { path: "b", content: "x" }), step("bash", {}, "err")];
	assert.equal(stepsSummary(steps), "2 file · 1 errore");
	assert.equal(stepsSummary([step("read", {})]), "");
	assert.equal(duration(48), "48s");
	assert.equal(duration(72), "1m 12s");
	assert.equal(tokens(12400), "12,4k");
	assert.equal(tokens(340), "340");
});

test("a folded exchange: its prompt, files and time on one line", () => {
	const ex = exchanges([user(1, "crea l'endpoint\nGET /cart"), pi(2, [{ kind: "steps", steps: [step("write", { path: "a.js", content: "x" }), step("edit", { path: "b.js", oldText: "a", newText: "b" })] }], { seconds: 72 })])[0];
	assert.deepEqual(folded(ex), { ok: true, text: "crea l'endpoint GET /cart", meta: "2 file · 1m 12s" });
	const failed = exchanges([user(1, "x"), pi(2, [{ kind: "error", text: "boom" }])])[0];
	assert.equal(folded(failed).ok, false);
});

test("test runs: the counts in a bash step's output become its result and the block's summary", () => {
	const ok = step("bash", { command: "npm test" }, "ok", { ms: 2100, output: "  13 passing (2s)\n" });
	assert.deepEqual(stepResult(ok), [{ t: "13 pass", c: "ok" }, { t: "2,1s", c: "dim" }]);
	const node = step("bash", { command: "node --test" }, "ok", { output: "ℹ tests 30\nℹ pass 28\nℹ fail 2\n" });
	assert.deepEqual(stepResult(node), [{ t: "2 falliti su 30", c: "err" }]);
	const vitest = step("bash", { command: "npx vitest" }, "ok", { output: "Tests  12 passed (12)" });
	assert.deepEqual(stepResult(vitest), [{ t: "12 pass", c: "ok" }]);
	assert.equal(stepsSummary([step("edit", { path: "a", oldText: "a", newText: "b" }), ok]), "1 file · 13 test ok");
	assert.equal(stepsSummary([node]), "2 test falliti");
});
