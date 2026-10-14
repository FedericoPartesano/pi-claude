import { priceOrder } from "./src/orders.js";
const fail = (m) => { throw new Error(m); };
const stats = { total: 0, failed: [] };
const attempt = (label, fn) => { stats.total++; try { fn(); } catch (e) { stats.failed.push(`${label}: ${String(e.message).slice(0, 160)}`); } };
process.on("exit", () => { if (stats.failed.length) { process.exitCode = 1; console.error(`Error: ${stats.failed.length}/${stats.total} failed; first: ${stats.failed[0]}`); } if (process.env.HIDDEN_GRADED) console.log(`SCORE ${JSON.stringify({ total: stats.total, failed: stats.failed.length, samples: stats.failed.slice(0, 5) })}`); });
function ref(order) {
	let sub = 0;
	for (const l of order.lines) { const g = l.qty * l.unitPrice; sub += l.qty >= 10 ? Math.floor((g * 9 + 5) / 10) : g; }
	if (order.coupon === "SAVE5") sub = Math.max(0, sub - 500); else if (order.coupon === "HALF") sub = Math.floor((sub + 1) / 2);
	const shipping = order.lines.length === 0 ? 0 : sub >= 5000 ? 0 : 599;
	const tax = Math.floor((sub * 22 + 50) / 100);
	return { subtotal: sub, shipping, tax, total: sub + shipping + tax };
}
let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const orders = [{ lines: [] }, { lines: [], coupon: "SAVE5" }, { lines: [{ qty: 1, unitPrice: 100 }], coupon: "SAVE5" }, { lines: [{ qty: 10, unitPrice: 55 }] }, { lines: [{ qty: 9, unitPrice: 500 }, { qty: 1, unitPrice: 501 }], coupon: "HALF" }, { lines: [{ qty: 1, unitPrice: 5000 }] }, { lines: [{ qty: 1, unitPrice: 5500 }], coupon: "SAVE5" }, { lines: [{ qty: 1, unitPrice: 6000 }], coupon: "SAVE5" }, { lines: [{ qty: 1, unitPrice: 5 }], coupon: "NOPE" }];
for (let i = 0; i < 400; i++) {
	const lines = Array.from({ length: rnd(5) }, () => ({ qty: 1 + rnd(14), unitPrice: 1 + rnd(900) }));
	orders.push({ lines, ...(rnd(3) === 0 ? { coupon: ["SAVE5", "HALF", "NOPE"][rnd(3)] } : {}) });
}
for (const o of orders) attempt("order", () => {
	const snapshot = JSON.stringify(o);
	const got = priceOrder(o); const want = ref(o);
	if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${snapshot}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
	if (JSON.stringify(o) !== snapshot) fail("priceOrder mutated its input");
});
