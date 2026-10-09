/** A simulated year of use, month by month: node bench/longterm-sim.ts [days=365] (see test/longterm.ts). */
import { simulate } from "../test/longterm.ts";

for (const m of simulate(Number(process.argv[2] ?? 365))) {
	console.log(`day ${String(m.day).padStart(3)} | stored ${String(m.stored).padStart(5)} (active ${String(m.active).padStart(4)}, dormant ${String(m.dormant).padStart(4)}) forgotten ${String(m.forgotten).padStart(4)} | active topics found ${Math.round(m.foundShare * 100)}% | rules ${m.rulesFound}/${m.rulesAsked} | closed topics by deep search ${m.closed ? `${m.closedFound}/${m.closed}` : "-"} | max ${m.maxTokens} tok · p95 ${m.p95.toFixed(1)} ms`);
}
