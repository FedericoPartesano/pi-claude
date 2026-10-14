import { nextRun } from "./cron.js";
const fail = (m) => { throw new Error(m); };
const stats = { total: 0, failed: [] };
const attempt = (label, fn) => { stats.total++; try { fn(); } catch (e) { stats.failed.push(`${label}: ${String(e.message).slice(0, 200)}`); } };
process.on("exit", () => { if (process.env.HIDDEN_GRADED) console.log(`SCORE ${JSON.stringify({ total: stats.total, failed: stats.failed.length, samples: stats.failed.slice(0, 5) })}`); if (stats.failed.length) { process.exitCode = 1; console.error(`Error: ${stats.failed.length}/${stats.total} failed; first: ${stats.failed[0]}`); } });
const formats = new Map();
const local = (ms, tz) => {
	let f = formats.get(tz);
	if (!f) formats.set(tz, f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" }));
	const o = {}; for (const p of f.formatToParts(ms)) o[p.type] = p.value;
	return { minute: +o.minute, hour: +o.hour, dom: +o.day, month: +o.month, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday) };
};
const field = (text, min, max, isDow) => {
	const set = new Set();
	for (const part of text.split(",")) {
		const [range, step] = part.split("/"); const s = step ? +step : 1;
		let lo, hi;
		if (range === "*") { lo = min; hi = max; } else if (range.includes("-")) { [lo, hi] = range.split("-").map(Number); } else { lo = +range; hi = step ? max : lo; }
		for (let v = lo; v <= hi; v += s) set.add(isDow && v === 7 ? 0 : v);
	}
	return set;
};
const ref = (expr, from, tz, limitDays) => {
	const [m, h, dom, mon, dow] = expr.trim().split(/\s+/);
	const sets = { minute: field(m, 0, 59), hour: field(h, 0, 23), dom: field(dom, 1, 31), month: field(mon, 1, 12), dow: field(dow, 0, 7, true) };
	const domStar = dom.startsWith("*"), dowStar = dow.startsWith("*");
	for (let t = Math.floor(from / 60000) * 60000 + 60000, end = from + limitDays * 86400000; t <= end; t += 60000) {
		const l = local(t, tz);
		if (!sets.minute.has(l.minute) || !sets.hour.has(l.hour) || !sets.month.has(l.month)) continue;
		const d = sets.dom.has(l.dom), w = sets.dow.has(l.dow);
		if (domStar || dowStar ? d && w : d || w) return t;
	}
	return null;
};
const zones = ["UTC", "America/New_York", "Europe/Rome", "Australia/Lord_Howe", "Asia/Kolkata", "Pacific/Auckland"];
const exprs = ["30 2 * * *", "0 2 * * 1-5", "*/15 1-3 * * *", "30 1 * * *", "0 0 1 * *", "0 9 * * 1", "0 0 13 * 5", "15 14 1,15 * *", "0 */6 * * *", "59 1 * * 0", "0 0 * * 7", "5-59/20 * * * *", "0 12 */10 * *", "30 2 8 3 *", "30 1 1 11 *", "0 3 29 3 *", "45 2 * * 0", "0 0 31 * *", "10,20,50 0 * * 1,3", "0 12 * * 2-4/2"];
const bases = ["2026-03-07T10:00:00Z", "2026-03-28T00:00:00Z", "2026-10-03T05:00:00Z", "2026-10-31T20:00:00Z", "2026-04-04T00:00:00Z", "2026-09-26T00:00:00Z", "2026-01-31T23:59:59Z", "2026-12-31T23:30:00Z", "2028-02-27T00:00:00Z"];
let seed = 99; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) % n; };
const cases = [];
for (let i = 0; i < 70; i++) cases.push([exprs[rnd(exprs.length)], Date.parse(bases[rnd(bases.length)]) + rnd(40) * 3600000 + rnd(3) * 60000 + rnd(3) * 1000, zones[rnd(zones.length)]]);
for (const tz of ["America/New_York", "Europe/Rome", "Australia/Lord_Howe"]) for (const e of ["30 2 * * *", "30 1 * * *"]) cases.push([e, Date.parse("2026-03-01T00:00:00Z"), tz], [e, Date.parse("2026-10-01T00:00:00Z"), tz]);
for (const [expr, from, tz] of cases) attempt(`${expr} @${new Date(from).toISOString()} ${tz}`, () => {
	const want = ref(expr, from, tz, 75), got = nextRun(expr, from, tz);
	if (want === null) { if (got !== null && got - from <= 75 * 86400000) fail(`got ${new Date(got).toISOString()}, want later`); return; }
	if (got !== want) fail(`got ${got === null ? null : new Date(got).toISOString()}, want ${new Date(want).toISOString()}`);
});
attempt("never matches -> null", () => { if (nextRun("0 0 30 2 *", Date.parse("2026-01-01T00:00:00Z"), "UTC") !== null) fail("expected null"); });
attempt("strictly after from", () => { const f = Date.parse("2026-05-05T10:00:00Z"); if (nextRun("0 10 * * *", f, "UTC") !== f + 86400000) fail("not strictly after"); });
for (const bad of ["* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "*/0 * * * *", "5-1 * * * *", "a * * * *", ""]) attempt(`syntax ${JSON.stringify(bad)}`, () => { try { nextRun(bad, Date.now(), "UTC"); } catch (e) { if (e instanceof SyntaxError) return; fail(`threw ${e?.constructor?.name}`); } fail("no throw"); });
attempt("bad timezone -> RangeError", () => { try { nextRun("* * * * *", Date.now(), "Mars/Base"); } catch (e) { if (e instanceof RangeError) return; fail(`threw ${e?.constructor?.name}`); } fail("no throw"); });
