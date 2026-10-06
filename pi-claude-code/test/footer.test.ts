import assert from "node:assert/strict";
import test from "node:test";
import { formatReset, renderSubscriptionStatus, usageBar, usageRole } from "../src/footer.ts";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const at = (minutes: number) => NOW / 1000 + minutes * 60;

test("formatReset", () => {
	assert.equal(formatReset(at(45), NOW), "45m");
	assert.equal(formatReset(at(130), NOW), "2h10m");
	assert.equal(formatReset(at(3 * 24 * 60 + 4 * 60), NOW), "3g 4h");
	assert.equal(formatReset(at(-5), NOW), "0m");
});

test("usageBar fills proportionally and shows any usage", () => {
	assert.equal(usageBar(0), "▱▱▱▱▱▱▱▱");
	assert.equal(usageBar(0.01), "▰▱▱▱▱▱▱▱");
	assert.equal(usageBar(0.5), "▰▰▰▰▱▱▱▱");
	assert.equal(usageBar(1), "▰▰▰▰▰▰▰▰");
	assert.equal(usageBar(1.4), "▰▰▰▰▰▰▰▰");
});

test("usageRole thresholds", () => {
	assert.deepEqual([0.1, 0.59, 0.6, 0.84, 0.85, 1].map(usageRole), ["success", "success", "warning", "warning", "error", "error"]);
});

test("footer: one bar per window, reset only on the 5h one", () => {
	const info = { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.31, resetsAt: at(130) }, seven_day: { utilization: 0.11, resetsAt: at(5000) } } };
	assert.equal(renderSubscriptionStatus(info, NOW), "5h ▰▰▱▱▱▱▱▱ 31% · reset 2h10m   7g ▰▱▱▱▱▱▱▱ 11%");
});

test("footer paints by severity and flags overage", () => {
	const info = { status: "allowed", isUsingOverage: true, unifiedWindows: { five_hour: { utilization: 0.9 }, seven_day: { utilization: 0.2 } } };
	const text = renderSubscriptionStatus(info, NOW, (role, t) => `<${role}>${t}</${role}>`);
	assert.match(text, /<error>▰▰▰▰▰▰▰▱<\/error> <error>90%<\/error>/);
	assert.match(text, /<success>20%<\/success>/);
	assert.match(text, /<error>crediti extra in uso<\/error>/);
});
