import assert from "node:assert/strict";
import { test } from "node:test";
import { TodoWatch } from "./guard/todo.ts";

const list = (...statuses: string[]) => ({ tasks: statuses.map((status) => ({ status })) });

test("TodoWatch: tace finché ci sono pochi passi, poi avvisa e ripete a distanza", () => {
	const watch = new TodoWatch();
	watch.result("todo", list("in_progress", "pending"), false);
	const said: (string | undefined)[] = [];
	for (let i = 0; i < 14; i++) said.push(watch.result("edit", undefined, false));
	assert.deepEqual(said.map((s) => Boolean(s)), [false, false, false, false, true, false, false, false, false, false, false, false, true, false]);
	assert.match(said[4]!, /5 azioni .*\(2 ancora aperti/);
});

test("TodoWatch: lettura e ricerca non contano, un aggiornamento azzera", () => {
	const watch = new TodoWatch();
	watch.result("todo", list("pending"), false);
	for (let i = 0; i < 20; i++) assert.equal(watch.result("read", undefined, false), undefined);
	for (let i = 0; i < 4; i++) watch.result("bash", undefined, false);
	watch.result("todo", list("completed", "pending"), false);
	for (let i = 0; i < 4; i++) assert.equal(watch.result("bash", undefined, false), undefined);
});

test("TodoWatch: senza voci aperte o senza lista non dice mai niente", () => {
	const watch = new TodoWatch();
	for (let i = 0; i < 10; i++) assert.equal(watch.result("edit", undefined, false), undefined);
	watch.result("todo", list("completed", "deleted"), false);
	for (let i = 0; i < 10; i++) assert.equal(watch.result("edit", undefined, false), undefined);
	assert.equal(watch.reminder(), undefined);
});

test("TodoWatch.reminder: al nuovo messaggio, una volta sola, se la lista è rimasta indietro", () => {
	const watch = new TodoWatch();
	watch.result("todo", list("in_progress"), false);
	watch.result("edit", undefined, false);
	watch.result("edit", undefined, false);
	assert.equal(watch.reminder(), undefined, "troppo presto");
	watch.result("bash", undefined, false);
	assert.match(watch.reminder()!, /3 azioni e 1 voci/);
	assert.equal(watch.reminder(), undefined, "una volta sola");
});

test("TodoWatch.fromBranch: ricostruisce lo stato da una sessione ripresa", () => {
	const msg = (toolName: string, details?: unknown) => ({ type: "message", message: { role: "toolResult", toolName, details } });
	const watch = TodoWatch.fromBranch([msg("todo", list("pending")), msg("edit"), msg("edit"), msg("bash"), { type: "message", message: { role: "user" } }]);
	assert.match(watch.reminder()!, /3 azioni/);
});
