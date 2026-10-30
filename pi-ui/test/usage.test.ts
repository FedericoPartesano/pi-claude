import { test } from "node:test";
import assert from "node:assert/strict";
import { forecastLines, resetLabel, type Usage } from "../src/usage.ts";

const NOW = new Date(2026, 9, 30, 9, 0, 0).getTime();
const MIN = 60_000;
/** Samples every 2 minutes over 8 minutes, rising `step` per sample, ending at `end`. */
const history = (end: number, step: number) => [0, 1, 2, 3, 4].map((i) => ({ at: NOW - (4 - i) * 2 * MIN, u: end - (4 - i) * step }));

test("forecast waits for enough samples", () => {
	const usage: Usage = { fiveHour: 0.5, history: { five_hour: [{ at: NOW, u: 0.5 }] } };
	assert.deepEqual(forecastLines(usage, "five_hour", NOW), [{ role: "dim", label: "Previsione", value: "dopo 3 min d'uso" }]);
	assert.deepEqual(forecastLines(usage, "seven_day", NOW), []);
});

test("forecast flags in red when the limit is hit before the reset", () => {
	// +1% per 2 min = 0.5%/min, 46% left -> ~92 min; reset in 3 h.
	const usage: Usage = { fiveHour: 0.54, fiveHourResetsAt: (NOW + 180 * MIN) / 1000, history: { five_hour: history(0.54, 0.01) } };
	const rows = forecastLines(usage, "five_hour", NOW);
	assert.equal(rows[0].value, "0.5%/min");
	assert.deepEqual(rows.slice(1).map((r) => [r.role, r.label]), [["err", "⚠ Esaurimento"], ["err", "Prima del reset"]]);
	assert.equal(rows[1].value, "10:32");
	assert.equal(rows[2].value, "1h28m");
});

test("forecast is green and shows the margin when the reset comes first", () => {
	const usage: Usage = { fiveHour: 0.54, fiveHourResetsAt: (NOW + 30 * MIN) / 1000, history: { five_hour: history(0.54, 0.01) } };
	const rows = forecastLines(usage, "five_hour", NOW);
	assert.deepEqual(rows[1], { role: "ok", label: "Al reset restano", value: "~31%" });
});

test("forecast reports a flat consumption", () => {
	const usage: Usage = { fiveHour: 0.5, history: { five_hour: history(0.5, 0) } };
	assert.deepEqual(forecastLines(usage, "five_hour", NOW), [{ role: "ok", label: "Consumo", value: "fermo" }]);
});

test("weekly forecast uses a longer window", () => {
	const week = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ at: NOW - (180 - i * 30) * MIN, u: 0.7 + i * 0.01 }));
	const usage: Usage = { sevenDay: 0.76, sevenDayResetsAt: (NOW + 2 * 24 * 60 * MIN) / 1000, history: { seven_day: week } };
	const rows = forecastLines(usage, "seven_day", NOW);
	assert.equal(rows[0].value, "2.0%/h");
	assert.equal(rows[1].role, "err");
});

test("resetLabel: time today, day and time later, nothing when unknown or past", () => {
	assert.equal(resetLabel((NOW + 60 * MIN) / 1000, NOW), "10:00");
	assert.match(resetLabel((NOW + 3 * 24 * 60 * MIN) / 1000, NOW)!, /^\w{3} \d\d:\d\d$/);
	assert.equal(resetLabel(undefined, NOW), undefined);
	assert.equal(resetLabel((NOW - MIN) / 1000, NOW), undefined);
});
