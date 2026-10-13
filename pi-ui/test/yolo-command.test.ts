import assert from "node:assert/strict";
import { test } from "node:test";

test("/no-permissions: on, off e inversione cambiano PI_YOLO e avvisano", async () => {
	const commands: Record<string, any> = {};
	const quiet: any = new Proxy(() => {}, { get: () => quiet, apply: () => quiet });
	const pi: any = new Proxy({ events: quiet, registerCommand: (n: string, c: any) => (commands[n] = c) }, { get: (t: any, k: string) => t[k] ?? (() => {}) });
	const { default: piUi } = await import("../index.ts");
	await piUi(pi);
	const cmd = commands["no-permissions"];
	assert.ok(cmd, "comando registrato");
	const notes: string[] = [];
	const ctx = { ui: { notify: (m: string) => notes.push(m) } };
	const before = process.env.PI_YOLO;
	try {
		delete process.env.PI_YOLO;
		await cmd.handler("on", ctx); assert.equal(process.env.PI_YOLO, "1"); assert.match(notes.at(-1)!, /attiva/);
		await cmd.handler("off", ctx); assert.equal(process.env.PI_YOLO, undefined); assert.match(notes.at(-1)!, /spenta/);
		await cmd.handler("", ctx); assert.equal(process.env.PI_YOLO, "1");
		await cmd.handler("", ctx); assert.equal(process.env.PI_YOLO, undefined);
		await cmd.handler("boh", ctx); assert.match(notes.at(-1)!, /Uso/); assert.equal(process.env.PI_YOLO, undefined);
	} finally { if (before === undefined) delete process.env.PI_YOLO; else process.env.PI_YOLO = before; }
});
