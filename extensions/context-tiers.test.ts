import assert from "node:assert/strict";
import { test } from "node:test";
import { createTiers } from "./context-tiers.ts";

const big = (n: number) => ({ role: "toolResult", toolCallId: `t${n}`, toolName: "bash", content: [{ type: "text", text: `${n}:` + "riga\n".repeat(3000) }] });
const turn = (n: number) => [{ role: "assistant", content: [] }, big(n)];
const history = (count: number) => Array.from({ length: count }, (_, i) => turn(i)).flat();
const len = (ms: any[]) => ms.reduce((s, m) => s + JSON.stringify(m.content).length, 0);

test("sotto il limite non cambia nulla", () => {
	const tiers = createTiers({ limitTokens: 1e9 });
	const ms = history(20);
	assert.equal(tiers(ms), ms);
});
test("sopra il limite riduce i vecchi risultati e tiene interi i recenti", () => {
	const tiers = createTiers({ limitTokens: 20000, keep: 4 });
	const out = tiers(history(20)) as any[];
	assert.ok(len(out) < len(history(20)) / 3);
	assert.match(out[1].content[0].text, /nascosti/);
	assert.doesNotMatch(out.at(-1)!.content[0].text, /nascosti/);
});
test("la scelta e' stabile: stesso prefisso tra una chiamata e l'altra (cache)", () => {
	const tiers = createTiers({ limitTokens: 20000, keep: 4 });
	const a = tiers(history(20)) as any[];
	const b = tiers(history(21)) as any[];
	assert.deepEqual(a.slice(0, 30), b.slice(0, 30));
});
test("gli errori non vengono nascosti", () => {
	const tiers = createTiers({ limitTokens: 20000, keep: 2 });
	const ms: any[] = history(20); ms[1] = { ...ms[1], isError: true };
	assert.doesNotMatch((tiers(ms) as any[])[1].content[0].text, /nascosti/);
});
